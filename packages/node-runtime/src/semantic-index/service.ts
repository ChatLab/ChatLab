/**
 * 语义索引共享 service（node-runtime，Electron 与 CLI Web 复用）
 *
 * 职责：把配置、向量库、业务状态、串行队列、warmup、检索、证据组装与聊天库适配器
 * 编排成一个有状态服务。每个运行时进程一个实例，由 server 启动时创建、停止时 close。
 * 不做隐藏全局单例。
 *
 * 关键约定（见用户决策）：
 * - 启用/状态以业务状态表为权威，队列只负责执行。
 * - 模型身份（resolveModelId）变化即需重建；模型身份不变（仅换 API Key）不重建。
 *   身份不一致时检索不使用旧索引。
 * - 启动恢复只把 stale running 标记为 paused，不自动续跑。
 */

import path from 'node:path'
import {
  writeAuthProfile as defaultWriteAuthProfile,
  resolveApiKey as defaultResolveApiKey,
  type AuthProfile,
} from '@openchatlab/config'
import type { DatabaseAdapter, PathProvider } from '@openchatlab/core'
import {
  CHUNKER_VERSION,
  DEFAULT_CHUNKER_CONFIG,
  computeChunkerConfigHash,
  computeDbPathHash,
  STRATEGY_ID,
} from './chunker-config'
import type { ChunkSource } from './chunker'
import {
  isKeylessSemanticIndexApiBaseUrl,
  SemanticIndexConfigStore,
  type SemanticIndexConfig,
  type SemanticIndexConfigInput,
} from './config'
import { createEmbedder, type EmbedderFactoryDeps } from './embedder-factory'
import type { EmbeddingProvider } from './embedding/types'
import { EmbeddingIndexStore, type LoadSqliteVec } from './store'
import {
  SemanticIndexStateStore,
  type SemanticIndexSessionState,
  type SemanticIndexStatus,
} from './session-state-store'
import { SemanticIndexJobQueue, type JobContext } from './warmup/job-queue'
import { runWarmup } from './warmup/runner'
import { hybridSearch } from './retrieval/hybrid-search'
import { assembleEvidence, type EvidenceBlock, type EvidenceBudget, type EvidenceHit } from './retrieval/evidence'
import { createChatDbMessageSource } from './chat-db/message-source'
import { createChatDbMessageRangeReader } from './chat-db/message-range-reader'
import { createChatDbFtsSearcher } from './chat-db/fts-searcher'
import type { SessionRuntimeAdapter } from '../services/adapters'
import { clampSearchMaxResults, SEARCH_MAX_RESULTS_HARD_CAP } from './config'
import { applyPreprocessingPipeline } from '../ai/preprocessor/preprocessing-pipeline'
import type { PreprocessConfig, PreprocessableMessage } from '../ai/preprocessor/types'

export interface SemanticIndexServiceOptions {
  /** embedding_index.db 路径（{vectorDir}/embedding_index.db） */
  vectorDbPath: string
  /** semantic-index-config.json 路径（{aiDataDir}/semantic-index-config.json） */
  configPath: string
  sessionAdapter: SessionRuntimeAdapter
  /** 本地模型缓存目录 */
  modelsCacheDir?: string
  /** embedder 工厂注入（测试/平台） */
  embedderFactoryDeps?: EmbedderFactoryDeps
  /** sqlite-vec 加载器注入（Electron 打包） */
  loadSqliteVec?: LoadSqliteVec
  /** better-sqlite3 原生绑定路径（CLI 打包需要） */
  nativeBinding?: string
  /** auth profile 写入注入（测试用，避免写真实 ~/.chatlab） */
  writeAuthProfile?: (name: string, profile: AuthProfile) => void
}

/** 语义索引 API Key 固定存储在此 auth profile；config 只保存引用，不保存明文 */
export const SEMANTIC_INDEX_AUTH_PROFILE = 'semantic-index-embedding'

export interface SemanticIndexSessionStatus {
  sessionId: string
  enabled: boolean
  indexStatus: SemanticIndexStatus
  needsRebuild: boolean
  /** completed session has received new messages since last index run */
  hasNewMessages?: boolean
  totalMessages: number
  indexedMessages: number
  chunkCount: number
  coverage: number
  queued: boolean
  running: boolean
  partial: boolean
  error: string | null
  modelId: string | null
}

export type SemanticSearchReason = 'disabled' | 'needs-rebuild' | 'empty' | 'not-found'

/** 面向 AI 工具的安全来源条目（已脱敏，不含原始消息）。结构与 @openchatlab/tools 一致。 */
export interface SemanticSearchToolSource {
  startMessageId: number
  endMessageId: number
  score: number
  chunkIds: string[]
  snippet: string
  text?: string
  startTime?: string
  endTime?: string
}

/** 面向 AI 工具的检索结果：text 已经过 applyPreprocessingPipeline 清洗/脱敏/匿名化/截断 */
export interface SemanticSearchToolResult {
  available: boolean
  reason?: string
  text: string
  returned: number
  hitCount: number
  partial: boolean
  coverage: number
  truncated: boolean
  timeRange?: { earliest: string; latest: string }
  sources: SemanticSearchToolSource[]
}

export interface SemanticSearchToolOptions {
  maxResults?: number
  preprocessConfig?: Record<string, unknown>
  ownerPlatformId?: string
  locale?: string
  maxResultTokens?: number
  /** 毫秒级时间范围过滤（可单边）；仅保留与 chunk 时间范围有交集的语义候选 */
  timeFilter?: { startTs?: number; endTs?: number }
}

/** 工具返回片段预览的最大字符数 */
const SEARCH_TOOL_SNIPPET_MAX = 160

/**
 * 注入证据的固定 token 预算（与 max_results 解耦）。
 * max_results 只决定召回候选数，最终注入量由本预算（再以 maxResultTokens 封顶）控制，
 * 避免候选变多导致上下文 token 膨胀；单块 soft cap 保持较小，让宽泛检索优先增加结果数量。
 */
const SEARCH_TOOL_EVIDENCE_TOKENS = 8000

export function resolveSearchToolEvidenceTokens(maxResultTokens?: number): number {
  return maxResultTokens && maxResultTokens > 0
    ? Math.min(SEARCH_TOOL_EVIDENCE_TOKENS, maxResultTokens)
    : SEARCH_TOOL_EVIDENCE_TOKENS
}

export interface SemanticSearchResult {
  available: boolean
  reason?: SemanticSearchReason
  blocks: EvidenceBlock[]
  coverage: number
  /** 索引未完成时为 true，证据可能不完整 */
  partial: boolean
  /** RRF 融合后的候选命中数（证据组装前） */
  hitCount: number
}

function sessionIdFromDbPath(dbPath: string): string {
  return path.basename(dbPath, '.db')
}

/** 语义索引相关文件名（统一约定，避免各端硬编码） */
export const SEMANTIC_INDEX_DB_FILE = 'embedding_index.db'
export const SEMANTIC_INDEX_CONFIG_FILE = 'semantic-index-config.json'

/**
 * 按 PathProvider 约定路径创建 service：
 * - 向量库：{vectorDir}/embedding_index.db
 * - 配置：{aiDataDir}/semantic-index-config.json
 * - 本地模型缓存：{cacheDir}/models/semantic-index
 */
export function createSemanticIndexService(params: {
  pathProvider: PathProvider
  sessionAdapter: SessionRuntimeAdapter
  nativeBinding?: string
  loadSqliteVec?: LoadSqliteVec
  embedderFactoryDeps?: EmbedderFactoryDeps
}): SemanticIndexService {
  const { pathProvider } = params
  return new SemanticIndexService({
    vectorDbPath: path.join(pathProvider.getVectorDir(), SEMANTIC_INDEX_DB_FILE),
    configPath: path.join(pathProvider.getAiDataDir(), SEMANTIC_INDEX_CONFIG_FILE),
    modelsCacheDir: path.join(pathProvider.getCacheDir(), 'models', 'semantic-index'),
    sessionAdapter: params.sessionAdapter,
    nativeBinding: params.nativeBinding,
    loadSqliteVec: params.loadSqliteVec,
    embedderFactoryDeps: params.embedderFactoryDeps,
  })
}

export class SemanticIndexService {
  private store: EmbeddingIndexStore
  private stateStore: SemanticIndexStateStore
  private configStore: SemanticIndexConfigStore
  private queue: SemanticIndexJobQueue
  private sessionAdapter: SessionRuntimeAdapter
  private options: SemanticIndexServiceOptions

  private embedder: EmbeddingProvider | null = null
  private embedderModelId: string | null = null

  /** 当前激活的 chunker 身份（version + 参数 hash），随索引记录用于重建判定 */
  private readonly chunkerVersion = CHUNKER_VERSION
  private readonly chunkerConfigHash = computeChunkerConfigHash(DEFAULT_CHUNKER_CONFIG)

  constructor(options: SemanticIndexServiceOptions) {
    this.options = options
    this.sessionAdapter = options.sessionAdapter
    this.store = new EmbeddingIndexStore(options.vectorDbPath, {
      loadSqliteVec: options.loadSqliteVec,
      nativeBinding: options.nativeBinding,
    })
    this.stateStore = new SemanticIndexStateStore(options.vectorDbPath, { nativeBinding: options.nativeBinding })
    this.configStore = new SemanticIndexConfigStore(options.configPath)
    this.queue = new SemanticIndexJobQueue((ctx) => this.runJob(ctx))
  }

  // ---------- 配置 ----------

  getConfig(): SemanticIndexConfig {
    return this.configStore.get()
  }

  /** 用户是否已显式配置向量模型（区分默认兜底配置） */
  isConfigured(): boolean {
    return this.configStore.isConfigured()
  }

  /** 全局功能开关是否开启 */
  isEnabled(): boolean {
    return this.configStore.isEnabled()
  }

  /** 语义索引是否可实际建立/检索：全局开启且已选择模型 */
  canRun(): boolean {
    if (!this.configStore.canRun()) return false
    const cfg = this.configStore.get()
    return cfg.mode !== 'api' || isKeylessSemanticIndexApiBaseUrl(cfg.api?.baseUrl) || this.hasApiKey()
  }

  /** 当前 API 模式是否已配置可用的 API Key（不返回明文，仅布尔） */
  hasApiKey(): boolean {
    const cfg = this.configStore.get()
    if (cfg.mode !== 'api' || !cfg.api || !cfg.api.authProfile) return false
    const resolve = this.options.embedderFactoryDeps?.resolveApiKey ?? defaultResolveApiKey
    return resolve('semantic-index', cfg.api.authProfile) !== ''
  }

  /**
   * 保存配置；模型身份变化会使已启用对话的索引在重建完成前不被检索使用。
   * 传入 apiKey 时写入固定 auth profile，config 内只保存引用，绝不持久化明文。
   */
  setConfig(config: SemanticIndexConfigInput, options?: { apiKey?: string }): SemanticIndexConfig {
    let next = config
    if (options?.apiKey && config.mode === 'api' && config.api) {
      const writer = this.options.writeAuthProfile ?? defaultWriteAuthProfile
      writer(SEMANTIC_INDEX_AUTH_PROFILE, { type: 'api_key', provider: 'semantic-index', key: options.apiKey })
      next = { ...config, api: { ...config.api, authProfile: SEMANTIC_INDEX_AUTH_PROFILE } }
    }
    const saved = this.configStore.set(next)
    this.embedder = null
    this.embedderModelId = null
    // 关闭全局开关时停止所有在跑/排队的建索引任务（保留已建立的部分数据）
    if (!saved.enabled) {
      for (const state of this.stateStore.listEnabled()) this.queue.pause(state.dbPathHash)
    }
    return saved
  }

  private currentModelId(): string {
    return this.configStore.resolveModelId()
  }

  private getEmbedder(): EmbeddingProvider {
    const modelId = this.currentModelId()
    if (!this.embedder || this.embedderModelId !== modelId) {
      this.embedder = createEmbedder(this.configStore.get(), {
        modelsCacheDir: this.options.modelsCacheDir,
        ...this.options.embedderFactoryDeps,
      })
      this.embedderModelId = modelId
    }
    return this.embedder
  }

  // ---------- 启用 / 生命周期 ----------

  private hashFor(sessionId: string): string {
    return computeDbPathHash(sessionId)
  }

  /** 索引身份是否与当前运行时不一致（模型身份或 chunker 身份变化 => 需重建） */
  private isStale(state: SemanticIndexSessionState, currentModelId: string): boolean {
    return (
      state.modelId !== currentModelId ||
      state.chunkerVersion !== this.chunkerVersion ||
      state.chunkerConfigHash !== this.chunkerConfigHash
    )
  }

  private enableParams(dbPath: string): {
    dbPathHash: string
    dbPath: string
    modelId: string
    chunkerVersion: string
    chunkerConfigHash: string
  } {
    return {
      dbPathHash: computeDbPathHash(sessionIdFromDbPath(dbPath)),
      dbPath,
      modelId: this.currentModelId(),
      chunkerVersion: this.chunkerVersion,
      chunkerConfigHash: this.chunkerConfigHash,
    }
  }

  enable(sessionId: string): void {
    if (!this.canRun()) return
    const dbPath = this.sessionAdapter.getDbPath(sessionId)
    const hash = computeDbPathHash(sessionId)
    const existing = this.stateStore.getState(hash)
    const stale = !!existing && this.isStale(existing, this.currentModelId())
    if (stale) {
      // 保留旧身份字段，只重置 enabled 和 index_status。
      // 这样 app 在 rebuild 运行前退出后，重启时 buildAllPending() 仍能通过
      // isStale() 检测到需重建并入队 rebuild，避免永久卡死在"新身份+无向量"状态。
      this.stateStore.reactivate(hash, dbPath)
      this.stateStore.setIndexStatus(hash, 'idle')
    } else {
      this.stateStore.enable(this.enableParams(dbPath))
    }
  }

  disable(sessionId: string): void {
    const hash = this.hashFor(sessionId)
    this.queue.cancel(hash)
    this.stateStore.disable(hash)
  }

  /** 建立 / 续跑索引（续跑从断点游标继续） */
  build(sessionId: string): void {
    if (!this.canRun()) return
    this.queue.enqueue({ type: 'build', dbPathHash: this.hashFor(sessionId) })
  }

  pause(sessionId: string): void {
    this.queue.pause(this.hashFor(sessionId))
  }

  cancel(sessionId: string): void {
    this.queue.cancel(this.hashFor(sessionId))
  }

  /** 重建：换模型身份或用户主动重建时清空旧索引后重新建立 */
  rebuild(sessionId: string): void {
    if (!this.canRun()) return
    const dbPath = this.sessionAdapter.getDbPath(sessionId)
    const hash = computeDbPathHash(sessionId)
    this.queue.cancel(hash)
    this.stateStore.enable(this.enableParams(dbPath))
    this.queue.enqueue({ type: 'rebuild', dbPathHash: hash })
  }

  /** 为所有启用但未完成 / 需重建的对话入队（"建立待处理索引"） */
  buildAllPending(): void {
    if (!this.canRun()) return
    const modelId = this.currentModelId()
    for (const state of this.stateStore.listEnabled()) {
      if (state.indexStatus === 'running') continue
      if (this.isStale(state, modelId)) {
        this.queue.enqueue({ type: 'rebuild', dbPathHash: state.dbPathHash })
      } else if (state.indexStatus !== 'completed') {
        this.queue.enqueue({ type: 'build', dbPathHash: state.dbPathHash })
      } else {
        // Completed sessions may have received new messages since last index run
        const sessionId = sessionIdFromDbPath(state.dbPath)
        const db = this.sessionAdapter.openReadonly(sessionId)
        if (db) {
          const liveCount = (db.prepare('SELECT COUNT(*) AS c FROM message').get() as { c: number } | undefined)?.c ?? 0
          if (liveCount > state.totalMessages) {
            this.queue.enqueue({ type: 'build', dbPathHash: state.dbPathHash })
          } else if (liveCount < state.totalMessages) {
            // Messages were deleted (e.g. member deletion); must rebuild to remove stale vectors
            this.queue.enqueue({ type: 'rebuild', dbPathHash: state.dbPathHash })
          }
        }
      }
    }
  }

  // ---------- 状态 ----------

  private toStatus(state: SemanticIndexSessionState, currentModelId: string): SemanticIndexSessionStatus {
    const needsRebuild = state.enabled && this.isStale(state, currentModelId)
    const coverage = state.totalMessages > 0 ? Math.min(1, state.indexedMessages / state.totalMessages) : 0
    return {
      sessionId: sessionIdFromDbPath(state.dbPath),
      enabled: state.enabled,
      indexStatus: state.indexStatus,
      needsRebuild,
      totalMessages: state.totalMessages,
      indexedMessages: state.indexedMessages,
      chunkCount: state.chunkCount,
      coverage,
      queued: this.queue.isQueued(state.dbPathHash),
      running: this.queue.isRunning(state.dbPathHash),
      partial: state.indexStatus !== 'completed',
      error: state.error,
      modelId: state.modelId,
    }
  }

  status(sessionId: string): SemanticIndexSessionStatus | null {
    const state = this.stateStore.getState(this.hashFor(sessionId))
    if (!state) return null
    return this.toStatus(state, this.currentModelId())
  }

  /** 批量查询多个对话状态（未启用的返回 null 过滤） */
  statusForSessions(sessionIds: string[]): SemanticIndexSessionStatus[] {
    const modelId = this.currentModelId()
    const result: SemanticIndexSessionStatus[] = []
    for (const sessionId of sessionIds) {
      const state = this.stateStore.getState(this.hashFor(sessionId))
      if (state) result.push(this.toStatus(state, modelId))
    }
    return result
  }

  listEnabledStatuses(): SemanticIndexSessionStatus[] {
    const modelId = this.currentModelId()
    return this.stateStore.listEnabled().map((s) => {
      const status = this.toStatus(s, modelId)
      if (s.indexStatus === 'completed' && !status.needsRebuild && !status.queued && !status.running) {
        const sessionId = sessionIdFromDbPath(s.dbPath)
        const db = this.sessionAdapter.openReadonly(sessionId)
        if (db) {
          const liveCount = (db.prepare('SELECT COUNT(*) AS c FROM message').get() as { c: number } | undefined)?.c ?? 0
          if (liveCount !== s.totalMessages) status.hasNewMessages = true
        }
      }
      return status
    })
  }

  // ---------- 检索 ----------

  async search(
    sessionId: string,
    query: string,
    options?: { finalTopK?: number; budget?: EvidenceBudget; timeRangeMs?: { startTs?: number; endTs?: number } }
  ): Promise<SemanticSearchResult> {
    if (!this.canRun())
      return { available: false, reason: 'disabled', blocks: [], coverage: 0, partial: false, hitCount: 0 }

    const hash = this.hashFor(sessionId)
    const state = this.stateStore.getState(hash)
    const modelId = this.currentModelId()

    if (!state || !state.enabled)
      return { available: false, reason: 'disabled', blocks: [], coverage: 0, partial: false, hitCount: 0 }
    if (this.isStale(state, modelId))
      return { available: false, reason: 'needs-rebuild', blocks: [], coverage: 0, partial: true, hitCount: 0 }

    const dim = this.store.getDim(hash, modelId)
    if (!dim || state.chunkCount === 0)
      return {
        available: false,
        reason: 'empty',
        blocks: [],
        coverage: 0,
        partial: state.indexStatus !== 'completed',
        hitCount: 0,
      }

    const db = this.sessionAdapter.openReadonly(sessionId)
    if (!db) return { available: false, reason: 'not-found', blocks: [], coverage: 0, partial: false, hitCount: 0 }

    const embedder = this.getEmbedder()
    const fts = createChatDbFtsSearcher(db)
    const finalTopK = options?.finalTopK ?? 5
    // 候选池随 finalTopK 放大：短 chunk 下保证高 max_results 时召回覆盖足够（下限保持默认 40）
    const candidateTopN = Math.max(40, finalTopK * 4)
    const hits = await hybridSearch(
      { embedder, store: this.store, fts },
      {
        query,
        dbPathHash: hash,
        modelId,
        strategyId: STRATEGY_ID,
        dim,
        finalTopK,
        denseTopN: candidateTopN,
        ftsTopN: candidateTopN,
        timeRangeMs: options?.timeRangeMs,
      }
    )

    const evidenceHits: EvidenceHit[] = hits.map((h) => ({
      chunkId: h.chunkId,
      score: h.score,
      parentId: h.record.parentId,
      startMessageId: h.record.startMessageId,
      endMessageId: h.record.endMessageId,
      startTs: h.record.startTs,
      endTs: h.record.endTs,
    }))
    const reader = createChatDbMessageRangeReader(db)
    const { blocks } = assembleEvidence(reader, evidenceHits, options?.budget)

    const coverage = state.totalMessages > 0 ? Math.min(1, state.indexedMessages / state.totalMessages) : 0
    return { available: true, blocks, coverage, partial: state.indexStatus !== 'completed', hitCount: hits.length }
  }

  /**
   * 当前会话是否可被 AI 工具检索。
   * 已启用 + 模型身份一致 + 有 chunk + 维度可用即可（running/paused/failed 只要已有 chunk 也可，结果标记 partial）。
   * 未启用 / 需重建 / 无 chunk 返回 false，runner 据此不向 LLM 暴露检索工具。
   */
  canSearch(sessionId: string): boolean {
    if (!this.canRun()) return false
    const hash = this.hashFor(sessionId)
    const state = this.stateStore.getState(hash)
    if (!state || !state.enabled) return false
    const modelId = this.currentModelId()
    if (this.isStale(state, modelId)) return false
    if (state.chunkCount <= 0) return false
    return !!this.store.getDim(hash, modelId)
  }

  /**
   * 面向 AI 工具的检索：复用 search()，再用 applyPreprocessingPipeline 对证据做清洗/脱敏/匿名化/截断。
   * 工具层只拿到安全文本与安全 metadata，绝不接触原始消息。
   */
  async searchForTool(
    sessionId: string,
    query: string,
    options?: SemanticSearchToolOptions
  ): Promise<SemanticSearchToolResult> {
    const unavailable = (reason: string, partial = false): SemanticSearchToolResult => ({
      available: false,
      reason,
      text: '',
      returned: 0,
      hitCount: 0,
      partial,
      coverage: 0,
      truncated: false,
      sources: [],
    })

    const q = query?.trim()
    if (!q) return unavailable('empty-query')

    const configuredDefault = clampSearchMaxResults(this.configStore.get().searchMaxResults)
    const requested = options?.maxResults ?? configuredDefault
    const finalTopK = Math.max(1, Math.min(SEARCH_MAX_RESULTS_HARD_CAP, Math.floor(requested)))

    // 注入预算与 max_results 解耦：固定预算再以工具结果预算（maxResultTokens）封顶。
    // finalTopK 只放大召回候选数，不放大注入 token，避免大范围查询撑爆上下文。
    const evidenceTokens = resolveSearchToolEvidenceTokens(options?.maxResultTokens)

    let result: SemanticSearchResult
    try {
      result = await this.search(sessionId, q, {
        finalTopK,
        budget: { maxChunks: finalTopK, totalTokens: evidenceTokens },
        timeRangeMs: options?.timeFilter,
      })
    } catch (err) {
      return unavailable(err instanceof Error ? err.message : String(err))
    }
    if (!result.available) return unavailable(result.reason ?? 'unavailable', result.partial)

    // 归一化预处理配置：补齐数组字段，避免 partial 配置导致管道崩溃（脱敏规则仍以传入为准）
    const preprocessConfig = options?.preprocessConfig
      ? ({ blacklistKeywords: [], desensitizeRules: [], ...options.preprocessConfig } as unknown as PreprocessConfig)
      : undefined
    const anonymizeNames = !!preprocessConfig?.anonymizeNames
    const locale = options?.locale
    const ownerPlatformId = options?.ownerPlatformId

    const sources: SemanticSearchToolSource[] = []
    const blockTexts: string[] = []
    // 全局昵称映射（仅 anonymize 时使用），保证整段证据只出现一次 name map
    const nameMap = new Map<number, { name: string; platformId?: string }>()
    let earliest = Number.POSITIVE_INFINITY
    let latest = Number.NEGATIVE_INFINITY

    for (const block of result.blocks) {
      const rawMessages: PreprocessableMessage[] = block.messages.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        senderName: m.senderName,
        senderPlatformId: m.senderPlatformId,
        content: m.content,
        // EvidenceMessage.ts 是毫秒；预处理管道按秒渲染时间（format.ts 内部 *1000），故此处回退为秒
        timestamp: Math.floor(m.ts / 1000),
      }))
      for (const m of block.messages) {
        if (m.senderId != null && !nameMap.has(m.senderId)) {
          nameMap.set(m.senderId, { name: m.senderName, platformId: m.senderPlatformId })
        }
      }
      // 每块统一过 applyPreprocessingPipeline 做清洗/脱敏/匿名化；用 details.messages（不含 name map 行）
      const { details } = applyPreprocessingPipeline({
        rawMessages,
        preprocessConfig,
        locale,
        anonymizeNames,
        ownerPlatformId,
      })
      const lines = Array.isArray(details.messages) ? (details.messages as string[]) : []
      const safeText = lines.join('\n').trim()
      const first = block.messages[0]
      const last = block.messages[block.messages.length - 1]
      const startTime = first ? new Date(first.ts).toISOString() : undefined
      const endTime = last ? new Date(last.ts).toISOString() : undefined
      for (const m of block.messages) {
        if (m.ts < earliest) earliest = m.ts
        if (m.ts > latest) latest = m.ts
      }
      const snippet =
        safeText.length > SEARCH_TOOL_SNIPPET_MAX ? `${safeText.slice(0, SEARCH_TOOL_SNIPPET_MAX)}…` : safeText
      sources.push({
        startMessageId: block.startMessageId,
        endMessageId: block.endMessageId,
        score: block.score,
        chunkIds: block.chunkIds,
        snippet,
        text: safeText,
        startTime,
        endTime,
      })
      const rangeLabel = startTime && endTime ? `${startTime} ~ ${endTime}` : ''
      blockTexts.push(`--- ${rangeLabel}\n${safeText}`)
    }

    let text = blockTexts.join('\n\n')
    if (anonymizeNames && nameMap.size > 0) {
      const entries = [...nameMap.entries()].map(
        ([id, { name, platformId }]) =>
          `U${id}=${name}${ownerPlatformId && platformId === ownerPlatformId ? '(owner)' : ''}`
      )
      text = `[Name Map] ${entries.join(' | ')}\n\n${text}`
    }

    const timeRange =
      Number.isFinite(earliest) && Number.isFinite(latest)
        ? { earliest: new Date(earliest).toISOString(), latest: new Date(latest).toISOString() }
        : undefined

    // 命中候选已填满 finalTopK 上限，说明可能还有更多相关历史，提示用更具体 query 继续
    const truncated = result.hitCount >= finalTopK

    return {
      available: true,
      text,
      returned: result.blocks.length,
      hitCount: result.hitCount,
      partial: result.partial,
      coverage: result.coverage,
      truncated,
      timeRange,
      sources,
    }
  }

  // ---------- 清理 ----------

  /** 清理已停用待清理的对话索引，以及无对应业务状态的孤儿 chunk */
  cleanupUnused(): { cleaned: number } {
    let cleaned = 0

    // 检测已删除的对话（DB 文件不再存在）：将其状态标为 pending cleanup，交由下方统一清理
    const activeSessionIds = new Set(this.sessionAdapter.listSessionIds())
    for (const state of this.stateStore.listAll()) {
      if (state.cleanupStatus !== 'pending' && !activeSessionIds.has(sessionIdFromDbPath(state.dbPath))) {
        this.queue.cancel(state.dbPathHash)
        this.stateStore.disable(state.dbPathHash)
      }
    }

    for (const state of this.stateStore.listPendingCleanup()) {
      this.queue.cancel(state.dbPathHash)
      this.store.deleteByDbPathHash(state.dbPathHash)
      this.stateStore.resetProgress(state.dbPathHash)
      this.stateStore.setCleanupStatus(state.dbPathHash, 'done')
      cleaned++
    }
    const known = new Set(this.stateStore.listAll().map((s) => s.dbPathHash))
    for (const hash of this.store.listDbPathHashes()) {
      if (!known.has(hash)) {
        this.store.deleteByDbPathHash(hash)
        cleaned++
      }
    }
    return { cleaned }
  }

  // ---------- 启动恢复 ----------

  /** 启动时把中断的 running 标记为 paused，保留断点；不自动续跑 */
  recover(): void {
    for (const state of this.stateStore.listAll()) {
      if (state.indexStatus === 'running') {
        this.stateStore.setIndexStatus(state.dbPathHash, 'paused')
      }
    }
  }

  // ---------- 队列执行 ----------

  private resolveSource(db: DatabaseAdapter): ChunkSource {
    try {
      const row = db.prepare('SELECT name, type FROM meta LIMIT 1').get() as
        | { name?: string; type?: string }
        | undefined
      const kind: ChunkSource['kind'] = row?.type === 'group' ? 'group' : 'private'
      return { title: row?.name ?? '', kind }
    } catch {
      return { title: '', kind: 'private' }
    }
  }

  private async runJob(ctx: JobContext): Promise<void> {
    const { job, checkStop } = ctx
    if (job.type === 'cleanup') {
      this.cleanupUnused()
      return
    }

    const state = this.stateStore.getState(job.dbPathHash)
    if (!state || !state.enabled) return
    const sessionId = sessionIdFromDbPath(state.dbPath)

    const db = this.sessionAdapter.openReadonly(sessionId)
    if (!db) {
      this.stateStore.setIndexStatus(job.dbPathHash, 'failed', 'session database not found')
      return
    }

    if (job.type === 'rebuild') {
      this.store.deleteByDbPathHash(job.dbPathHash)
      this.stateStore.resetProgress(job.dbPathHash)
      // 以当前模型/chunker 身份重建：刷新状态身份，确保完成后 needsRebuild=false、可检索
      this.stateStore.setBuildIdentity(job.dbPathHash, {
        modelId: this.currentModelId(),
        chunkerVersion: this.chunkerVersion,
        chunkerConfigHash: this.chunkerConfigHash,
      })
    }

    const source = createChatDbMessageSource(db, this.resolveSource(db))
    await runWarmup({
      dbPathHash: job.dbPathHash,
      modelId: this.currentModelId(),
      embedder: this.getEmbedder(),
      store: this.store,
      stateStore: this.stateStore,
      source,
      checkStop,
    })
  }

  /** 等待队列清空（优雅停止 / 测试用） */
  whenIdle(): Promise<void> {
    return this.queue.whenIdle()
  }

  close(): void {
    this.store.close()
    this.stateStore.close()
  }
}
