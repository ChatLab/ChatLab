import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CHAT_DB_SCHEMA, FTS_TABLE_SCHEMA } from '@openchatlab/core'
import { openBetterSqliteDatabase } from '../better-sqlite3-adapter'
import { buildFtsIndex } from '../fts'
import { SemanticIndexService } from './service'
import { SemanticIndexStateStore } from './session-state-store'
import { computeDbPathHash } from './chunker-config'
import { BGE_PROFILE, QWEN3_PROFILE } from './embedding/profiles'
import type { SessionRuntimeAdapter } from '../services/adapters'
import type { LocalPipelineFactory } from './embedding/local'

const SESSION_ID = 'sess1'
// 真实秒级基准时间（2023-11-14），用于让证据 snippet 渲染出真实年份，
// 暴露「毫秒被当作秒再 *1000」导致五位数年份（如 56150）的回归。
const BASE_TS_SECONDS = 1_700_000_000

function setup(opts?: { embedDelayMs?: number }) {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  const dir = fs.mkdtempSync(path.join(baseDir, 'chatlab-si-svc-'))
  const chatDbPath = path.join(dir, `${SESSION_ID}.db`)
  const db = openBetterSqliteDatabase(chatDbPath)
  db.exec(CHAT_DB_SCHEMA)
  db.exec(FTS_TABLE_SCHEMA)
  db.exec(`
    INSERT INTO meta (name, platform, type, imported_at) VALUES ('测试群', 'wechat', 'group', 0);
    INSERT INTO member (id, platform_id, account_name) VALUES (1, 'p1', '张三'), (2, 'p2', '李四');
  `)
  const insert = db.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, 0, ?)')
  for (let i = 1; i <= 40; i++) {
    insert.run(i, (i % 2) + 1, BASE_TS_SECONDS + i * 60, `第${i}条关于项目排期和需求讨论的消息内容`)
  }
  buildFtsIndex(db)

  const adapter: SessionRuntimeAdapter = {
    listSessionIds: () => [SESSION_ID],
    openReadonly: (id) => (id === SESSION_ID ? db : null),
    openWritable: (id) => (id === SESSION_ID ? db : null),
    closeSession: () => {},
    getDbPath: () => chatDbPath,
    deleteSessionFile: () => false,
    ensureReadonly: (id) => {
      if (id !== SESSION_ID) throw new Error('not found')
      return db
    },
    ensureWritable: (id) => {
      if (id !== SESSION_ID) throw new Error('not found')
      return db
    },
  }

  // 本地 pipeline 工厂：返回 BGE 维度向量，按文本长度给一点变化，避免零向量
  // embedTextCount 统计累计嵌入文本数，用于区分 rebuild(重新嵌入) 与 build 续跑(跳过不嵌入)
  let embedTextCount = 0
  const localPipelineFactory: LocalPipelineFactory = async () => async (texts) => {
    embedTextCount += texts.length
    if (opts?.embedDelayMs) await new Promise((r) => setTimeout(r, opts.embedDelayMs))
    return texts.map((t) => {
      const v = new Array(BGE_PROFILE.dim).fill(0)
      v[t.length % BGE_PROFILE.dim] = 1
      return v
    })
  }

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
  })

  return { service, chatDbPath, dir, db, authProfiles, getEmbedCount: () => embedTextCount }
}

test('enable builds index to completion and reports status', async () => {
  const { service, db } = setup()
  service.enable(SESSION_ID)
  await service.whenIdle()

  const status = service.status(SESSION_ID)!
  assert.equal(status.enabled, true)
  assert.equal(status.indexStatus, 'completed')
  assert.ok(status.chunkCount > 0)
  assert.equal(status.totalMessages, 40)
  assert.equal(status.needsRebuild, false)
  assert.ok(status.coverage > 0)
  service.close()
  db.close()
})

test('search returns evidence blocks for an enabled completed index', async () => {
  const { service, db } = setup()
  service.enable(SESSION_ID)
  await service.whenIdle()

  const result = await service.search(SESSION_ID, '项目排期')
  assert.equal(result.available, true)
  assert.ok(result.blocks.length > 0)
  assert.equal(result.partial, false)
  service.close()
  db.close()
})

test('changing model identity marks needsRebuild and blocks search until rebuilt', async () => {
  const { service, db } = setup()
  service.enable(SESSION_ID)
  await service.whenIdle()

  // 切换到不同本地模型 -> 身份变化 -> 需重建
  service.setConfig({ version: 1, mode: 'local', local: { modelId: QWEN3_PROFILE.modelId }, api: null })
  assert.equal(service.status(SESSION_ID)!.needsRebuild, true)
  const blocked = await service.search(SESSION_ID, '项目排期')
  assert.equal(blocked.available, false)
  assert.equal(blocked.reason, 'needs-rebuild')

  // 切回原模型 -> 身份恢复 -> 旧索引可复用
  service.setConfig({ version: 1, mode: 'local', local: { modelId: BGE_PROFILE.modelId }, api: null })
  assert.equal(service.status(SESSION_ID)!.needsRebuild, false)
  const restored = await service.search(SESSION_ID, '项目排期')
  assert.equal(restored.available, true)
  service.close()
  db.close()
})

test('changing chunker identity marks needsRebuild and blocks search until rebuilt', async () => {
  const { service, chatDbPath, dir, db } = setup()
  service.enable(SESSION_ID)
  await service.whenIdle()
  assert.equal(service.status(SESSION_ID)!.needsRebuild, false)
  assert.equal(service.canSearch(SESSION_ID), true)

  // 模拟索引由旧 chunker 参数建立：直接改写状态表中的 chunker_config_hash
  const external = openBetterSqliteDatabase(path.join(dir, 'embedding_index.db'))
  external
    .prepare('UPDATE semantic_index_session SET chunker_config_hash = ? WHERE db_path_hash = ?')
    .run('stale-cfg', computeDbPathHash(chatDbPath))
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
  service.close()
  db.close()
})

test('buildAllPending rebuilds a stale index back to searchable', async () => {
  const { service, chatDbPath, dir, db, getEmbedCount } = setup()
  service.enable(SESSION_ID)
  await service.whenIdle()
  const afterFirstBuild = getEmbedCount()
  assert.ok(afterFirstBuild > 0)

  // 模拟旧 chunker 参数建立的索引 -> 当前版本判定为 stale
  const external = openBetterSqliteDatabase(path.join(dir, 'embedding_index.db'))
  external
    .prepare('UPDATE semantic_index_session SET chunker_config_hash = ? WHERE db_path_hash = ?')
    .run('stale-cfg', computeDbPathHash(chatDbPath))
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
  service.close()
  db.close()
})

test('re-enabling a stale index rebuilds instead of resuming stale chunks', async () => {
  const { service, chatDbPath, dir, db, getEmbedCount } = setup()
  service.enable(SESSION_ID)
  await service.whenIdle()
  const afterFirstBuild = getEmbedCount()

  const external = openBetterSqliteDatabase(path.join(dir, 'embedding_index.db'))
  external
    .prepare('UPDATE semantic_index_session SET chunker_config_hash = ? WHERE db_path_hash = ?')
    .run('stale-cfg', computeDbPathHash(chatDbPath))
  external.close()

  // 重新启用旧 stale 索引：必须走 rebuild(重新嵌入)，而不是按旧游标续建跳过
  service.enable(SESSION_ID)
  await service.whenIdle()

  assert.ok(getEmbedCount() > afterFirstBuild, 're-enabling a stale index should rebuild, not resume-skip')
  assert.equal(service.status(SESSION_ID)!.needsRebuild, false)
  assert.equal(service.canSearch(SESSION_ID), true)
  service.close()
  db.close()
})

test('disable then cleanup removes the index and blocks search', async () => {
  const { service, db } = setup()
  service.enable(SESSION_ID)
  await service.whenIdle()

  service.disable(SESSION_ID)
  const disabledStatus = service.status(SESSION_ID)!
  assert.equal(disabledStatus.enabled, false)
  const blocked = await service.search(SESSION_ID, '排期')
  assert.equal(blocked.available, false)
  assert.equal(blocked.reason, 'disabled')

  const { cleaned } = service.cleanupUnused()
  assert.ok(cleaned >= 1)
  service.close()
  db.close()
})

test('rebuild wipes and rebuilds the index', async () => {
  const { service, db } = setup()
  service.enable(SESSION_ID)
  await service.whenIdle()
  const before = service.status(SESSION_ID)!.chunkCount

  service.rebuild(SESSION_ID)
  await service.whenIdle()
  const after = service.status(SESSION_ID)!
  assert.equal(after.indexStatus, 'completed')
  assert.equal(after.chunkCount, before)
  service.close()
  db.close()
})

test('setConfig stores API key by reference only and hasApiKey reflects it', async () => {
  const { service, authProfiles, db } = setup()

  assert.equal(service.hasApiKey(), false)

  const saved = service.setConfig(
    { version: 1, mode: 'api', local: { modelId: BGE_PROFILE.modelId }, api: { baseUrl: 'https://x', model: 'emb' } },
    { apiKey: 'sk-secret-123' }
  )

  // config 只保存引用，不保存明文
  assert.equal(saved.api?.authProfile, 'semantic-index-embedding')
  assert.ok(!JSON.stringify(saved).includes('sk-secret-123'))
  // 明文写入 auth profile 存储
  assert.equal(authProfiles.get('semantic-index-embedding')?.key, 'sk-secret-123')
  assert.equal(service.hasApiKey(), true)
  service.close()
  db.close()
})

test('canSearch reflects availability: disabled/needs-rebuild/empty are false', async () => {
  const { service, db } = setup()

  // 未启用
  assert.equal(service.canSearch(SESSION_ID), false)

  service.enable(SESSION_ID)
  // 未完成建立前没有 chunk
  await service.whenIdle()
  assert.equal(service.canSearch(SESSION_ID), true)

  // 模型身份变化 -> 需重建 -> 不可检索
  service.setConfig({
    version: 1,
    mode: 'local',
    local: { modelId: QWEN3_PROFILE.modelId },
    api: null,
    searchMaxResults: 5,
  })
  assert.equal(service.canSearch(SESSION_ID), false)

  // 切回 -> 可检索
  service.setConfig({
    version: 1,
    mode: 'local',
    local: { modelId: BGE_PROFILE.modelId },
    api: null,
    searchMaxResults: 5,
  })
  assert.equal(service.canSearch(SESSION_ID), true)
  service.close()
  db.close()
})

test('searchForTool desensitizes + anonymizes via pipeline, never leaks raw', async () => {
  const { service, db } = setup()
  service.enable(SESSION_ID)
  await service.whenIdle()

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

  service.close()
  db.close()
})

test('searchForTool is unavailable when disabled or empty query', async () => {
  const { service, db } = setup()

  const disabled = await service.searchForTool(SESSION_ID, '项目排期')
  assert.equal(disabled.available, false)
  assert.equal(disabled.reason, 'disabled')

  service.enable(SESSION_ID)
  await service.whenIdle()
  const empty = await service.searchForTool(SESSION_ID, '   ')
  assert.equal(empty.available, false)
  assert.equal(empty.reason, 'empty-query')
  service.close()
  db.close()
})

test('searchForTool uses configured default max results when caller omits it', async () => {
  const { service, db } = setup()
  service.enable(SESSION_ID)
  await service.whenIdle()
  service.setConfig({
    version: 1,
    mode: 'local',
    local: { modelId: BGE_PROFILE.modelId },
    api: null,
    searchMaxResults: 5,
  })

  const result = await service.searchForTool(SESSION_ID, '项目排期')
  assert.equal(result.available, true)
  assert.ok(result.returned <= 5)
  service.close()
  db.close()
})

test('searchForTool honors maxResultTokens as evidence budget ceiling', async () => {
  const { service, db } = setup()
  service.enable(SESSION_ID)
  await service.whenIdle()

  const tiny = await service.searchForTool(SESSION_ID, '项目排期', { maxResults: 10, maxResultTokens: 10 })
  const big = await service.searchForTool(SESSION_ID, '项目排期', { maxResults: 10, maxResultTokens: 100000 })

  assert.equal(tiny.available, true)
  assert.equal(big.available, true)
  // 小预算必须显著截断证据文本，证明 maxResultTokens 被服务层消费
  assert.ok(tiny.text.length < big.text.length)
  assert.ok(tiny.returned <= big.returned)
  service.close()
  db.close()
})

test('searchForTool applies timeFilter to exclude out-of-range chunks', async () => {
  const { service, db } = setup()
  service.enable(SESSION_ID)
  await service.whenIdle()

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
  service.close()
  db.close()
})

test('recover marks stale running as paused without auto-resuming', async () => {
  const { service, chatDbPath, dir, db } = setup()
  service.enable(SESSION_ID)
  await service.whenIdle()

  // 模拟崩溃：另一连接把状态置为 running
  const external = new SemanticIndexStateStore(path.join(dir, 'embedding_index.db'))
  external.setIndexStatus(computeDbPathHash(chatDbPath), 'running')
  external.close()

  service.recover()
  assert.equal(service.status(SESSION_ID)!.indexStatus, 'paused')
  service.close()
  db.close()
})
