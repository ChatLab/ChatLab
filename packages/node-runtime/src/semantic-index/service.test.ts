import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { CHAT_DB_SCHEMA } from '@openchatlab/core'
import { openBetterSqliteDatabase } from '../better-sqlite3-adapter'
import {
  SemanticIndexService,
  persistSemanticIndexConfig,
  resolveSemanticIndexApiKeySet,
  SEMANTIC_INDEX_AUTH_PROFILE,
} from './service'
import { SemanticIndexConfigStore } from './config'
import { SemanticIndexStateStore } from './session-state-store'
import { computeDbPathHash } from './chunker-config'
import { BGE_BASE_PROFILE, QWEN3_PROFILE } from './embedding/profiles'
import type { SessionRuntimeAdapter } from '../services/adapters'
import type { FeatureExtractFn, LocalPipelineFactory } from './embedding/local'
import type { LocalEmbeddingRuntimeStatus } from './embedding/local-runtime'

const SESSION_ID = 'sess1'
const SERVICE_TEMP_DIR_PREFIX = 'chatlab-si-svc-'
// 真实秒级基准时间（2023-11-14），用于让证据 snippet 渲染出真实年份，
// 暴露「毫秒被当作秒再 *1000」导致五位数年份（如 56150）的回归。
const BASE_TS_SECONDS = 1_700_000_000

/** 合并产物那样的额外会话：消息 id 与主会话不同，但时间/发送者/正文可以一致 */
interface ExtraSession {
  sessionId: string
  messages: Array<{ id: number; senderId: number; ts: number; content: string }>
}

interface SetupOptions {
  extraSessions?: ExtraSession[]
  embedDelayMs?: number
  failFirstPipelineCreation?: boolean
  failPipelineCreationForModelIds?: ReadonlySet<string>
  onEmbedBatchStarted?: () => void
  localPipelineFactory?: LocalPipelineFactory
  getLocalEmbeddingRuntimeStatus?: () => LocalEmbeddingRuntimeStatus
}

interface ServiceFixture {
  service: SemanticIndexService
  chatDbPath: string
  dir: string
  db: ReturnType<typeof openBetterSqliteDatabase>
  authProfiles: Map<string, { key: string }>
  getEmbedCount: () => number
}

/** 建一个聊天库并写入 meta / member / message，会话名与成员和主会话一致（embedding 文本要用） */
function createChatDb(
  dbPath: string,
  messages: Array<{ id: number; senderId: number; ts: number; content: string }>
): ReturnType<typeof openBetterSqliteDatabase> {
  const db = openBetterSqliteDatabase(dbPath)
  db.exec(CHAT_DB_SCHEMA)
  db.exec(`
    INSERT INTO meta (name, platform, type, imported_at) VALUES ('测试群', 'wechat', 'group', 0);
    INSERT INTO member (id, platform_id, account_name) VALUES (1, 'p1', '张三'), (2, 'p2', '李四');
  `)
  const insert = db.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, 0, ?)')
  for (const message of messages) insert.run(message.id, message.senderId, message.ts, message.content)
  return db
}

/** 主会话的 40 条消息（合并测试要用同样的时间/发送者/正文重建一份） */
function baseMessages(): Array<{ id: number; senderId: number; ts: number; content: string }> {
  return Array.from({ length: 40 }, (_, index) => {
    const i = index + 1
    return {
      id: i,
      senderId: (i % 2) + 1,
      ts: BASE_TS_SECONDS + i * 60,
      content: `第${i}条关于项目排期和需求讨论的消息内容`,
    }
  })
}

interface ServiceFixtureCleanup {
  dir: string
  service?: SemanticIndexService
  db?: ReturnType<typeof openBetterSqliteDatabase>
  extraDbs?: Array<ReturnType<typeof openBetterSqliteDatabase>>
  disposePromise?: Promise<void>
}

function serviceTempBaseDir(): string {
  return process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
}

function removeOwnedServiceTempDir(dir: string): void {
  const baseDir = path.resolve(serviceTempBaseDir())
  const resolvedDir = path.resolve(dir)
  if (path.dirname(resolvedDir) !== baseDir || !path.basename(resolvedDir).startsWith(SERVICE_TEMP_DIR_PREFIX)) {
    throw new Error(`Refusing to remove non-owned semantic-index test directory: ${resolvedDir}`)
  }
  fs.rmSync(resolvedDir, { recursive: true, force: true })
}

async function disposeFixture(cleanup: ServiceFixtureCleanup): Promise<void> {
  if (cleanup.disposePromise) return cleanup.disposePromise
  cleanup.disposePromise = (async () => {
    try {
      // Stop queued/running work first so SQLite files are no longer used when the directory is removed.
      if (cleanup.service) {
        cleanup.service.setConfig({ ...cleanup.service.getConfig(), enabled: false })
        await cleanup.service.whenIdle()
      }
    } finally {
      try {
        cleanup.service?.close()
      } finally {
        try {
          cleanup.db?.close()
          for (const extra of cleanup.extraDbs ?? []) extra.close()
        } finally {
          removeOwnedServiceTempDir(cleanup.dir)
        }
      }
    }
  })()
  return cleanup.disposePromise
}

function setup(t: TestContext, opts?: SetupOptions): ServiceFixture {
  const baseDir = serviceTempBaseDir()
  const dir = fs.mkdtempSync(path.join(baseDir, SERVICE_TEMP_DIR_PREFIX))
  const cleanup: ServiceFixtureCleanup = { dir }
  t.after(() => disposeFixture(cleanup))

  const chatDbPath = path.join(dir, `${SESSION_ID}.db`)
  const db = createChatDb(chatDbPath, baseMessages())
  cleanup.db = db
  const databases = new Map([[SESSION_ID, db]])
  for (const extra of opts?.extraSessions ?? []) {
    databases.set(extra.sessionId, createChatDb(path.join(dir, `${extra.sessionId}.db`), extra.messages))
  }
  cleanup.extraDbs = [...databases.entries()].filter(([id]) => id !== SESSION_ID).map(([, value]) => value)
  const dbPathOf = (sessionId: string) => path.join(dir, `${sessionId}.db`)
  const requireDb = (id: string) => {
    const found = databases.get(id)
    if (!found) throw new Error('not found')
    return found
  }
  const adapter: SessionRuntimeAdapter = {
    listSessionIds: () => [...databases.keys()],
    openReadonly: (id) => databases.get(id) ?? null,
    openWritable: (id) => databases.get(id) ?? null,
    closeSession: () => {},
    getDbPath: dbPathOf,
    deleteSessionFile: () => false,
    ensureReadonly: requireDb,
    ensureWritable: requireDb,
  }

  // 本地 pipeline 工厂：返回 Qwen3 维度向量，按文本长度给一点变化，避免零向量
  // embedTextCount 统计累计嵌入文本数，用于区分 rebuild(重新嵌入) 与 build 续跑(跳过不嵌入)
  let embedTextCount = 0
  let pipelineCreateAttempts = 0
  const localPipelineFactory: LocalPipelineFactory =
    opts?.localPipelineFactory ??
    (async ({ modelId }) => {
      pipelineCreateAttempts++
      if (opts?.failFirstPipelineCreation && pipelineCreateAttempts === 1) {
        throw new Error('temporary preload failure')
      }
      if (opts?.failPipelineCreationForModelIds?.has(modelId)) {
        throw new Error(`temporary preload failure for ${modelId}`)
      }
      return async (texts) => {
        opts?.onEmbedBatchStarted?.()
        embedTextCount += texts.length
        if (opts?.embedDelayMs) await new Promise((r) => setTimeout(r, opts.embedDelayMs))
        return texts.map((t) => {
          const v = new Array(QWEN3_PROFILE.dim).fill(0)
          v[t.length % QWEN3_PROFILE.dim] = 1
          return v
        })
      }
    })

  // 内存 auth profile 存储：避免测试写真实 ~/.chatlab/auth-profiles.json
  const authProfiles = new Map<string, { key: string }>()

  const service = new SemanticIndexService({
    vectorDbPath: path.join(dir, 'embedding_index.db'),
    configPath: path.join(dir, 'ai', 'semantic-index-config.json'),
    sessionAdapter: adapter,
    writeAuthProfile: (name, profile) => authProfiles.set(name, { key: profile.key }),
    embedderFactoryDeps: {
      localPipelineFactory,
      resolveApiKey: (_provider, authProfile) => (authProfile ? (authProfiles.get(authProfile)?.key ?? '') : ''),
    },
    getLocalEmbeddingRuntimeStatus: opts?.getLocalEmbeddingRuntimeStatus,
  })
  cleanup.service = service
  // 默认配置不再预选模型；测试显式选择 Qwen3 本地模型，使建索引可执行
  service.setConfig({ version: 1, mode: 'local', local: { modelId: QWEN3_PROFILE.modelId }, api: null })

  return { service, chatDbPath, dir, db, authProfiles, getEmbedCount: () => embedTextCount }
}

async function enableAndBuild(service: SemanticIndexService): Promise<void> {
  service.enable(SESSION_ID)
  service.build(SESSION_ID)
  await service.whenIdle()
}

async function waitForModelStatus(
  service: SemanticIndexService,
  expected: ReturnType<SemanticIndexService['getModelStatus']>
): Promise<void> {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    if (service.getModelStatus() === expected) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(service.getModelStatus(), expected)
}

test('explicit build indexes an enabled session to completion and reports status', async (t) => {
  const { service } = setup(t)
  await enableAndBuild(service)

  const status = service.status(SESSION_ID)!
  assert.equal(status.enabled, true)
  assert.equal(status.indexStatus, 'completed')
  assert.ok(status.chunkCount > 0)
  assert.equal(status.totalMessages, 40)
  assert.equal(status.needsRebuild, false)
  assert.ok(status.coverage > 0)
})

test('enable only marks a session enabled without starting a build', async (t) => {
  const { service } = setup(t, { embedDelayMs: 25 })

  service.enable(SESSION_ID)

  const status = service.status(SESSION_ID)!
  assert.equal(status.enabled, true)
  assert.equal(status.indexStatus, 'idle')
  assert.equal(status.queued, false)
  assert.equal(status.running, false)
  assert.equal(status.chunkCount, 0)
})

test('search returns evidence blocks for an enabled completed index', async (t) => {
  const { service } = setup(t)
  await enableAndBuild(service)

  const result = await service.search(SESSION_ID, '项目排期')
  assert.equal(result.available, true)
  assert.ok(result.blocks.length > 0)
  assert.equal(result.partial, false)
})

test('successful warmup retry clears a previous local model preload error', async (t) => {
  const { service } = setup(t, { failFirstPipelineCreation: true })

  await waitForModelStatus(service, 'error')
  await enableAndBuild(service)

  assert.equal(service.status(SESSION_ID)!.indexStatus, 'completed')
  assert.equal(service.getModelStatus(), 'ready')
})

test('reports runtime installation separately from model file download', (t) => {
  const { service } = setup(t, {
    localPipelineFactory: async () => await new Promise<FeatureExtractFn>(() => {}),
    getLocalEmbeddingRuntimeStatus: () => 'installing',
  })

  assert.equal(service.getModelStatus(), 'installing-runtime')
})

test('stale local warmup completion does not mark current local model ready', async (t) => {
  let resolveFirstBatchStarted: () => void = () => {}
  const firstBatchStarted = new Promise<void>((resolve) => {
    resolveFirstBatchStarted = resolve
  })
  const { service } = setup(t, {
    embedDelayMs: 50,
    failPipelineCreationForModelIds: new Set([BGE_BASE_PROFILE.modelId]),
    onEmbedBatchStarted: resolveFirstBatchStarted,
  })

  service.enable(SESSION_ID)
  service.build(SESSION_ID)
  await firstBatchStarted

  service.setConfig({ version: 1, mode: 'local', local: { modelId: BGE_BASE_PROFILE.modelId }, api: null })
  await waitForModelStatus(service, 'error')
  await service.whenIdle()

  assert.equal(service.getModelStatus(), 'error')
})

test('stale model preload failure does not overwrite the current download source status', async (t) => {
  let resolveMirrorPreload: (extractor: FeatureExtractFn) => void = () => {}
  let rejectOfficialPreload: (reason?: unknown) => void = () => {}
  const officialPreload = new Promise<FeatureExtractFn>((_resolve, reject) => {
    rejectOfficialPreload = reject
  })
  const mirrorPreload = new Promise<FeatureExtractFn>((resolve) => {
    resolveMirrorPreload = resolve
  })
  const localPipelineFactory: LocalPipelineFactory = ({ modelDownloadSource }) =>
    modelDownloadSource === 'hf-mirror' ? mirrorPreload : officialPreload
  const { service } = setup(t, { localPipelineFactory })

  service.setConfig({
    version: 1,
    mode: 'local',
    local: { modelId: QWEN3_PROFILE.modelId, downloadSource: 'hf-mirror' },
    api: null,
  })
  resolveMirrorPreload(async () => [])
  await waitForModelStatus(service, 'ready')

  rejectOfficialPreload(new Error('stale official source failure'))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(service.getModelStatus(), 'ready')
})

test('stale model preload success does not overwrite the current download source status', async (t) => {
  let resolveOfficialPreload: (extractor: FeatureExtractFn) => void = () => {}
  let rejectMirrorPreload: (reason?: unknown) => void = () => {}
  const officialPreload = new Promise<FeatureExtractFn>((resolve) => {
    resolveOfficialPreload = resolve
  })
  const mirrorPreload = new Promise<FeatureExtractFn>((_resolve, reject) => {
    rejectMirrorPreload = reject
  })
  const localPipelineFactory: LocalPipelineFactory = ({ modelDownloadSource }) =>
    modelDownloadSource === 'hf-mirror' ? mirrorPreload : officialPreload
  const { service } = setup(t, { localPipelineFactory })

  service.setConfig({
    version: 1,
    mode: 'local',
    local: { modelId: QWEN3_PROFILE.modelId, downloadSource: 'hf-mirror' },
    api: null,
  })
  rejectMirrorPreload(new Error('current mirror source failure'))
  await waitForModelStatus(service, 'error')

  resolveOfficialPreload(async () => [])
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(service.getModelStatus(), 'error')
})

test('changing model identity marks needsRebuild and blocks search until rebuilt', async (t) => {
  const { service } = setup(t)
  await enableAndBuild(service)

  // 切换到不同模型身份（改用 API）-> 身份变化 -> 需重建
  service.setConfig(
    {
      version: 1,
      mode: 'api',
      local: { modelId: QWEN3_PROFILE.modelId },
      api: { baseUrl: 'https://x', model: 'emb' },
    },
    { apiKey: 'sk-test' }
  )
  assert.equal(service.status(SESSION_ID)!.needsRebuild, true)
  const blocked = await service.search(SESSION_ID, '项目排期')
  assert.equal(blocked.available, false)
  assert.equal(blocked.reason, 'needs-rebuild')

  // 切回原本地模型 -> 身份恢复 -> 旧索引可复用
  service.setConfig({ version: 1, mode: 'local', local: { modelId: QWEN3_PROFILE.modelId }, api: null })
  assert.equal(service.status(SESSION_ID)!.needsRebuild, false)
  const restored = await service.search(SESSION_ID, '项目排期')
  assert.equal(restored.available, true)
})

test('changing chunker identity marks needsRebuild and blocks search until rebuilt', async (t) => {
  const { service, dir } = setup(t)
  await enableAndBuild(service)
  assert.equal(service.status(SESSION_ID)!.needsRebuild, false)
  assert.equal(service.canSearch(SESSION_ID), true)

  // 模拟索引由旧 chunker 参数建立：直接改写状态表中的 chunker_config_hash
  const external = openBetterSqliteDatabase(path.join(dir, 'embedding_index.db'))
  external
    .prepare('UPDATE semantic_index_session SET chunker_config_hash = ? WHERE db_path_hash = ?')
    .run('stale-cfg', computeDbPathHash(SESSION_ID))
  external.close()

  assert.equal(service.status(SESSION_ID)!.needsRebuild, true)
  assert.equal(service.canSearch(SESSION_ID), false)
  const blocked = await service.search(SESSION_ID, '项目排期')
  assert.equal(blocked.available, false)
  assert.equal(blocked.reason, 'needs-rebuild')

  // 重建后写入当前 chunker 身份 -> 恢复可检索
  service.rebuild(SESSION_ID)
  await service.whenIdle()
  assert.equal(service.status(SESSION_ID)!.needsRebuild, false)
  const restored = await service.search(SESSION_ID, '项目排期')
  assert.equal(restored.available, true)
})

test('buildAllPending rebuilds a stale index back to searchable', async (t) => {
  const { service, dir, getEmbedCount } = setup(t)
  await enableAndBuild(service)
  const afterFirstBuild = getEmbedCount()
  assert.ok(afterFirstBuild > 0)

  // 模拟旧 chunker 参数建立的索引 -> 当前版本判定为 stale
  const external = openBetterSqliteDatabase(path.join(dir, 'embedding_index.db'))
  external
    .prepare('UPDATE semantic_index_session SET chunker_config_hash = ? WHERE db_path_hash = ?')
    .run('stale-cfg', computeDbPathHash(SESSION_ID))
  external.close()
  assert.equal(service.status(SESSION_ID)!.needsRebuild, true)

  service.buildAllPending()
  await service.whenIdle()

  // 重建必须重新嵌入并刷新身份，否则完成后仍 needsRebuild / 不可检索
  assert.ok(getEmbedCount() > afterFirstBuild, 'stale rebuild should re-embed chunks')
  assert.equal(service.status(SESSION_ID)!.needsRebuild, false)
  assert.equal(service.canSearch(SESSION_ID), true)
  const result = await service.search(SESSION_ID, '项目排期')
  assert.equal(result.available, true)
})

test('re-enabling a stale index keeps it pending until explicit rebuild', async (t) => {
  const { service, dir, getEmbedCount } = setup(t)
  await enableAndBuild(service)
  const afterFirstBuild = getEmbedCount()

  const external = openBetterSqliteDatabase(path.join(dir, 'embedding_index.db'))
  external
    .prepare('UPDATE semantic_index_session SET chunker_config_hash = ? WHERE db_path_hash = ?')
    .run('stale-cfg', computeDbPathHash(SESSION_ID))
  external.close()

  // 重新启用旧 stale 索引：只恢复 enabled，不自动消耗算力/API 额度。
  service.enable(SESSION_ID)

  assert.equal(getEmbedCount(), afterFirstBuild)
  assert.equal(service.status(SESSION_ID)!.needsRebuild, true)
  assert.equal(service.canSearch(SESSION_ID), false)

  service.buildAllPending()
  await service.whenIdle()

  assert.ok(getEmbedCount() > afterFirstBuild, 'explicit pending rebuild should re-embed chunks')
  assert.equal(service.status(SESSION_ID)!.needsRebuild, false)
  assert.equal(service.canSearch(SESSION_ID), true)
})

test('remove clears index immediately and blocks search', async (t) => {
  const { service } = setup(t)
  await enableAndBuild(service)

  service.remove(SESSION_ID)
  // State record is deleted — status() returns null
  assert.equal(service.status(SESSION_ID), null)
  const blocked = await service.search(SESSION_ID, '排期')
  assert.equal(blocked.available, false)
  // cleanupUnused not needed; remove() is already immediate
})

test('re-enabling after remove rebuilds from scratch', async (t) => {
  const { service, getEmbedCount } = setup(t)
  await enableAndBuild(service)
  const afterFirstBuild = getEmbedCount()

  service.remove(SESSION_ID)

  await enableAndBuild(service)

  assert.ok(getEmbedCount() > afterFirstBuild, 're-enabling a cleaned index should embed chunks again')
  assert.equal(service.status(SESSION_ID)!.indexStatus, 'completed')
  assert.equal(service.canSearch(SESSION_ID), true)
  const result = await service.search(SESSION_ID, '项目排期')
  assert.equal(result.available, true)
})

test('rebuild wipes and rebuilds the index', async (t) => {
  const { service } = setup(t)
  await enableAndBuild(service)
  const before = service.status(SESSION_ID)!.chunkCount

  service.rebuild(SESSION_ID)
  await service.whenIdle()
  const after = service.status(SESSION_ID)!
  assert.equal(after.indexStatus, 'completed')
  assert.equal(after.chunkCount, before)
})

test('setConfig stores API key by reference only and hasApiKey reflects it', async (t) => {
  const { service, authProfiles } = setup(t)

  assert.equal(service.hasApiKey(), false)

  const saved = service.setConfig(
    { version: 1, mode: 'api', local: { modelId: QWEN3_PROFILE.modelId }, api: { baseUrl: 'https://x', model: 'emb' } },
    { apiKey: 'sk-secret-123' }
  )

  // config 只保存引用，不保存明文
  assert.equal(saved.api?.authProfile, 'semantic-index-embedding')
  assert.ok(!JSON.stringify(saved).includes('sk-secret-123'))
  // 明文写入 auth profile 存储
  assert.equal(authProfiles.get('semantic-index-embedding')?.key, 'sk-secret-123')
  assert.equal(service.hasApiKey(), true)
})

test('keyless local Ollama API config can run without an auth profile', async (t) => {
  const { service } = setup(t)

  service.setConfig({
    version: 1,
    mode: 'api',
    local: { modelId: QWEN3_PROFILE.modelId },
    api: { baseUrl: 'http://localhost:11434/v1', model: 'nomic-embed-text' },
  })

  assert.equal(service.hasApiKey(), false)
  assert.equal(service.isConfigured(), true)
  assert.equal(service.canRun(), true)
})

test('canSearch reflects availability: disabled/needs-rebuild/empty are false', async (t) => {
  const { service } = setup(t)

  // 未启用
  assert.equal(service.canSearch(SESSION_ID), false)

  service.enable(SESSION_ID)
  // 未显式建立前没有 chunk
  assert.equal(service.canSearch(SESSION_ID), false)

  service.build(SESSION_ID)
  await service.whenIdle()
  assert.equal(service.canSearch(SESSION_ID), true)

  // 模型身份变化（改用 API）-> 需重建 -> 不可检索
  service.setConfig({
    version: 1,
    mode: 'api',
    local: { modelId: QWEN3_PROFILE.modelId },
    api: { baseUrl: 'https://x', model: 'emb' },
    searchMaxResults: 5,
  })
  assert.equal(service.canSearch(SESSION_ID), false)

  // 切回本地模型 -> 可检索
  service.setConfig({
    version: 1,
    mode: 'local',
    local: { modelId: QWEN3_PROFILE.modelId },
    api: null,
    searchMaxResults: 5,
  })
  assert.equal(service.canSearch(SESSION_ID), true)
})

test('searchForTool desensitizes + anonymizes via pipeline, never leaks raw', async (t) => {
  const { service } = setup(t)
  await enableAndBuild(service)

  const result = await service.searchForTool(SESSION_ID, '项目排期', {
    preprocessConfig: {
      anonymizeNames: true,
      desensitize: true,
      desensitizeRules: [
        {
          id: 'r1',
          label: 'proj',
          pattern: '项目',
          replacement: '[REDACTED]',
          enabled: true,
          builtin: false,
          locales: [],
        },
      ],
    } as Record<string, unknown>,
    ownerPlatformId: 'p1',
    locale: 'zh-CN',
  })

  assert.equal(result.available, true)
  assert.ok(result.returned > 0)
  assert.ok(result.hitCount > 0)
  assert.ok(result.sources.length > 0)

  // 脱敏规则生效：原文被替换（关键风险：证据必须经 applyPreprocessingPipeline）
  assert.ok(result.text.includes('[REDACTED]'))
  assert.equal(result.text.includes('项目'), false)
  // 匿名化生效：LLM 文本只通过 name map 暴露一次映射，正文用 U{id}
  assert.ok(result.text.startsWith('[Name Map]'))

  for (const s of result.sources) {
    // snippet 已脱敏且不含原始昵称（匿名化为 U{id}），也不含 name map
    assert.equal(s.snippet.includes('项目'), false)
    assert.equal(s.snippet.includes('张三'), false)
    assert.equal(s.snippet.includes('[Name Map]'), false)
    assert.equal(s.text?.includes('项目'), false)
    assert.equal(s.text?.includes('张三'), false)
    assert.equal(s.text?.includes('[Name Map]'), false)
    assert.ok(typeof s.startMessageId === 'number')
    assert.ok(Array.isArray(s.chunkIds))
  }
  // 元数据不得夹带原始消息
  assert.equal(JSON.stringify(result.sources).includes('rawMessages'), false)

  // 回归：snippet 时间口径正确——证据消息 ts 是毫秒，预处理管道按秒渲染（内部 *1000），
  // 服务必须把毫秒转回秒，否则会渲染出五位数年份（如 2023 -> 56xxx）。
  const fiveDigitYear = /\b\d{5}\/\d{1,2}\/\d{1,2}/
  assert.equal(fiveDigitYear.test(result.text), false)
  assert.ok(result.text.includes('2023/'))
})

test('disabling the global switch blocks search and re-enabling keeps data usable', async (t) => {
  const { service } = setup(t)
  await enableAndBuild(service)
  assert.equal(service.canSearch(SESSION_ID), true)

  // 关闭全局开关：不暴露工具 + 检索返回 disabled（已建索引数据保留）
  service.setConfig({ version: 1, enabled: false, mode: 'local', local: { modelId: QWEN3_PROFILE.modelId }, api: null })
  assert.equal(service.isEnabled(), false)
  assert.equal(service.canSearch(SESSION_ID), false)
  const res = await service.search(SESSION_ID, '项目排期')
  assert.equal(res.available, false)
  assert.equal(res.reason, 'disabled')

  // 重新开启后可直接使用保留的索引
  service.setConfig({ version: 1, enabled: true, mode: 'local', local: { modelId: QWEN3_PROFILE.modelId }, api: null })
  assert.equal(service.canSearch(SESSION_ID), true)
})

test('searchForTool is unavailable when disabled or empty query', async (t) => {
  const { service } = setup(t)

  const disabled = await service.searchForTool(SESSION_ID, '项目排期')
  assert.equal(disabled.available, false)
  assert.equal(disabled.reason, 'disabled')

  await enableAndBuild(service)
  const empty = await service.searchForTool(SESSION_ID, '   ')
  assert.equal(empty.available, false)
  assert.equal(empty.reason, 'empty-query')
})

test('searchForTool uses configured default max results when caller omits it', async (t) => {
  const { service } = setup(t)
  await enableAndBuild(service)
  service.setConfig({
    version: 1,
    mode: 'local',
    local: { modelId: QWEN3_PROFILE.modelId },
    api: null,
    searchMaxResults: 5,
  })

  const result = await service.searchForTool(SESSION_ID, '项目排期')
  assert.equal(result.available, true)
  assert.ok(result.returned <= 5)
})

test('searchForTool honors maxResultTokens as evidence budget ceiling', async (t) => {
  const { service } = setup(t)
  await enableAndBuild(service)

  const tiny = await service.searchForTool(SESSION_ID, '项目排期', { maxResults: 10, maxResultTokens: 10 })
  const big = await service.searchForTool(SESSION_ID, '项目排期', { maxResults: 10, maxResultTokens: 100000 })

  assert.equal(tiny.available, true)
  assert.equal(big.available, true)
  // 小预算必须显著截断证据文本，证明 maxResultTokens 被服务层消费
  assert.ok(tiny.text.length < big.text.length)
  assert.ok(tiny.returned <= big.returned)
})

test('searchForTool applies timeFilter to exclude out-of-range chunks', async (t) => {
  const { service } = setup(t)
  await enableAndBuild(service)

  // 不带时间过滤：应有命中
  const all = await service.searchForTool(SESSION_ID, '项目排期', { maxResults: 10 })
  assert.equal(all.available, true)
  assert.ok(all.sources.length > 0)

  // 时间范围设在遥远未来：所有 chunk 都应被过滤掉（对秒/毫秒口径均成立）
  const farFuture = Date.now() + 10 * 365 * 24 * 3600 * 1000
  const future = await service.searchForTool(SESSION_ID, '项目排期', {
    maxResults: 10,
    timeFilter: { startTs: farFuture },
  })
  assert.equal(future.sources.length, 0)
  assert.equal(future.returned, 0)
})

function tempPersistStore(prefix: string): SemanticIndexConfigStore {
  const baseDir = serviceTempBaseDir()
  const dir = fs.mkdtempSync(path.join(baseDir, prefix))
  return new SemanticIndexConfigStore(path.join(dir, 'ai', 'semantic-index-config.json'))
}

// 回归：向量库不可用的降级路径（HTTP stub PUT 复用此 helper）必须持久化 API Key，
// 否则 API 模式在降级期会丢 key，恢复后出现"已配置但 hasApiKey=false 无法检索"。
test('persistSemanticIndexConfig (degraded path) saves API key by reference, never plaintext', () => {
  const store = tempPersistStore('chatlab-si-persist-')
  const authProfiles = new Map<string, { key: string }>()

  const saved = persistSemanticIndexConfig(
    store,
    { version: 1, mode: 'api', local: { modelId: '' }, api: { baseUrl: 'https://x', model: 'emb' } },
    { apiKey: 'sk-degraded-1', writeAuthProfile: (name, profile) => authProfiles.set(name, { key: profile.key }) }
  )

  assert.equal(saved.api?.authProfile, SEMANTIC_INDEX_AUTH_PROFILE)
  assert.ok(!JSON.stringify(saved).includes('sk-degraded-1'))
  assert.equal(authProfiles.get(SEMANTIC_INDEX_AUTH_PROFILE)?.key, 'sk-degraded-1')
  // 已落盘：重新读取仍保留引用
  assert.equal(store.get().api?.authProfile, SEMANTIC_INDEX_AUTH_PROFILE)

  const resolve = (_p: string, ap?: string) => (ap ? (authProfiles.get(ap)?.key ?? '') : '')
  assert.equal(resolveSemanticIndexApiKeySet(saved, resolve), true)
})

test('persistSemanticIndexConfig ignores apiKey in local mode (no auth profile write)', () => {
  const store = tempPersistStore('chatlab-si-persist-local-')
  const authProfiles = new Map<string, { key: string }>()

  const saved = persistSemanticIndexConfig(
    store,
    { version: 1, mode: 'local', local: { modelId: 'qwen3' }, api: null },
    { apiKey: 'should-be-ignored', writeAuthProfile: (name, profile) => authProfiles.set(name, { key: profile.key }) }
  )

  assert.equal(saved.mode, 'local')
  assert.equal(authProfiles.size, 0)
  assert.equal(resolveSemanticIndexApiKeySet(saved), false)
})

test('recover marks stale running as paused without auto-resuming', async (t) => {
  const { service, dir } = setup(t)
  await enableAndBuild(service)

  // 模拟崩溃：另一连接把状态置为 running
  const external = new SemanticIndexStateStore(path.join(dir, 'embedding_index.db'))
  external.setIndexStatus(computeDbPathHash(SESSION_ID), 'running')
  external.close()

  service.recover()
  assert.equal(service.status(SESSION_ID)!.indexStatus, 'paused')
})

// ==================== 合并会话的向量承接 ====================

const MERGED_ID = 'merged1'

/** 合并产物：同样的 40 条消息（id 全变）+ 尾部 5 条新消息 */
function mergedMessages(): Array<{ id: number; senderId: number; ts: number; content: string }> {
  const carried = baseMessages().map((message) => ({ ...message, id: message.id + 1000 }))
  const appended = Array.from({ length: 5 }, (_, index) => {
    const i = 41 + index
    return {
      id: 1000 + i,
      senderId: (i % 2) + 1,
      ts: BASE_TS_SECONDS + i * 60,
      content: `第${i}条合并后新增的消息内容`,
    }
  })
  return [...carried, ...appended]
}

function mergedFixture(t: TestContext): ServiceFixture {
  return setup(t, { extraSessions: [{ sessionId: MERGED_ID, messages: mergedMessages() }] })
}

test('carryOver does nothing while the semantic index is switched off', async (t) => {
  const { service } = mergedFixture(t)
  await enableAndBuild(service)
  service.setConfig({ ...service.getConfig(), enabled: false })

  assert.deepEqual(service.carryOver({ targetSessionId: MERGED_ID, sourceSessionIds: [SESSION_ID] }), {
    enabled: false,
  })
  assert.equal(service.status(MERGED_ID), null)
})

test('carryOver does not enable the merged session when no source has an index', async (t) => {
  const { service } = mergedFixture(t)

  assert.deepEqual(service.carryOver({ targetSessionId: MERGED_ID, sourceSessionIds: [SESSION_ID] }), {
    enabled: false,
  })
  assert.equal(service.status(MERGED_ID), null)
})

test('carryOver builds the merged session so it only embeds its new messages', async (t) => {
  const { service, getEmbedCount } = mergedFixture(t)
  await enableAndBuild(service)
  assert.ok(service.status(SESSION_ID)!.chunkCount > 0)

  const embedsBefore = getEmbedCount()
  const carried = service.carryOver({ targetSessionId: MERGED_ID, sourceSessionIds: [SESSION_ID] })
  assert.equal(carried.enabled, true)
  const carriedStatus = service.status(MERGED_ID)!
  assert.equal(carriedStatus.enabled, true)
  // 承接自己排队构建：合并后的向量无需用户再点一次"建立索引"
  assert.equal(carriedStatus.queued, true)

  await service.whenIdle()

  const merged = service.status(MERGED_ID)!
  assert.equal(merged.indexStatus, 'completed')
  // 默认参数下 40 条 -> 4 个 chunk，45 条 -> 5 个：前 3 个内容未变直接复用，
  // 只有被新消息改写的尾部 chunk 和新增的那个 chunk 需要 embedding。
  assert.equal(merged.chunkCount, 5)
  assert.equal(getEmbedCount() - embedsBefore, 2)
})
