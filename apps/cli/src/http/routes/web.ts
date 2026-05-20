/**
 * ChatLab Internal Web API — /_web/ routes
 *
 * 供 CLI serve Web 前端使用的内部 API（无认证、UI 友好的响应格式）。
 * 数据格式直接对齐 QueryAdapter 接口，避免前端二次转换。
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { FastifyInstance } from 'fastify'
import type { DatabaseManager } from '@openchatlab/node-runtime'
import type { TimeFilter } from '@openchatlab/shared-types'
import {
  getSessionInfo,
  getMembersWithAliases,
  getMembersPaginated,
  getTimeRange,
  getAvailableYears,
  getMemberActivity,
  getHourlyActivity,
  getDailyActivity,
  getWeekdayActivity,
  getMessageTypeStats,
  getMonthlyActivity,
  getYearlyActivity,
  getMessageLengthDistribution,
  executeSql,
  getSchemaDetailed,
  getRelationshipStats,
  getCatchphraseAnalysis,
  getMentionAnalysis,
  getMentionGraph,
  getLaughAnalysis,
  getClusterGraph,
  getLanguagePreferenceAnalysis,
  generateSessionIndex,
  clearSessionIndex,
} from '@openchatlab/core'
import {
  createJiebaNlpProvider,
  hasFtsTable,
  searchByFts,
  rebuildFtsIndex,
  completeSimple,
  type PiTextContent,
  generateSessionSummary,
  type SummaryDeps,
  exportFilterResultToMarkdown,
  streamParseFileInfo,
  checkConflictsFromSources,
  buildMergedOutput,
  serializeChatLabToJsonl,
  exportSessionToJson,
  TempDbReader,
} from '@openchatlab/node-runtime'
import { MergeSessionCache } from '../../merger/merge-cache'
import {
  getChatSessionSummary,
  saveChatSessionSummary,
  getChatSessionList,
  getSessionMessages,
} from '@openchatlab/core'
import {
  streamImport,
  incrementalImport,
  analyzeIncrementalImport,
  analyzeNewImport,
  detectFormat,
  detectAllFormats,
  getSupportedFormats,
  scanMultiChatFile,
  findEntryFileInDirectory,
} from '../../import'
import { getDefaultAssistantConfig, buildPiModel } from '../../ai/llm-config'

function resolveNativeBinding(): string | undefined {
  if (process.versions.electron) return undefined
  const nativePath = path.resolve(__dirname, '../../../native/better_sqlite3.node')
  if (fs.existsSync(nativePath)) return nativePath
  return undefined
}

function ensureDb(dbManager: DatabaseManager, sessionId: string) {
  const db = dbManager.open(sessionId)
  if (!db) {
    throw Object.assign(new Error(`Session not found: ${sessionId}`), { statusCode: 404 })
  }
  return db
}

function ensureWritableDb(dbManager: DatabaseManager, sessionId: string) {
  dbManager.close(sessionId)
  const db = dbManager.open(sessionId, { readonly: false })
  if (!db) {
    throw Object.assign(new Error(`Session not found: ${sessionId}`), { statusCode: 404 })
  }
  return db
}

function parseTimeFilter(query: Record<string, string | undefined>): TimeFilter | undefined {
  const { startTs, endTs, memberId } = query
  if (!startTs && !endTs && !memberId) return undefined
  const filter: TimeFilter = {}
  if (startTs) filter.startTs = parseInt(startTs, 10)
  if (endTs) filter.endTs = parseInt(endTs, 10)
  if (memberId) filter.memberId = parseInt(memberId, 10)
  return filter
}

function getAiDataDir(dbManager: DatabaseManager): string {
  const pathProvider = (dbManager as any)['pathProvider']
  if (!pathProvider) {
    throw Object.assign(new Error('PathProvider not available'), { statusCode: 500 })
  }
  return pathProvider.getAiDataDir()
}

function buildSummaryDeps(
  db: ReturnType<DatabaseManager['open']>,
  llmConfig: ReturnType<typeof getDefaultAssistantConfig> & object,
  _aiDataDir: string
): SummaryDeps {
  const piModel = buildPiModel(llmConfig)
  return {
    loadMessages(chatSessionId, limit = 500) {
      const data = getSessionMessages(db!, chatSessionId, limit)
      if (!data) return null
      return data.messages.map((m) => ({ senderName: m.senderName, content: m.content }))
    },
    saveSummary(chatSessionId, summary) {
      saveChatSessionSummary(db!, chatSessionId, summary)
    },
    getSummary(chatSessionId) {
      return getChatSessionSummary(db!, chatSessionId)
    },
    async llmComplete(systemPrompt, userPrompt, options) {
      const result = await completeSimple(
        piModel,
        {
          systemPrompt,
          messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }], timestamp: Date.now() }] as any,
        },
        { apiKey: llmConfig.apiKey, maxTokens: options?.maxTokens, temperature: options?.temperature }
      )
      return result.content
        .filter((item): item is PiTextContent => item.type === 'text')
        .map((item) => item.text)
        .join('')
    },
    t: (key: string) => key,
  }
}

export function registerWebRoutes(
  server: FastifyInstance,
  dbManager: DatabaseManager,
  options?: { pathProvider?: import('@openchatlab/core').PathProvider; nativeBinding?: string }
): void {
  const mergeCache = options?.pathProvider
    ? new MergeSessionCache(options.pathProvider, { nativeBinding: options.nativeBinding })
    : null
  mergeCache?.cleanupOrphans()
  // ==================== 会话管理 ====================

  server.get('/_web/sessions', async () => {
    const sessionIds = dbManager.listSessionIds()
    return sessionIds
      .map((id) => {
        const db = dbManager.open(id)
        if (!db) return null
        const info = getSessionInfo(db)
        if (!info) return null
        return {
          ...info,
          id,
          dbPath: '',
          memberAvatar: null,
          aiConversationCount: 0,
        }
      })
      .filter(Boolean)
  })

  server.get<{ Params: { id: string } }>('/_web/sessions/:id', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const info = getSessionInfo(db)
    if (!info) return null
    return {
      ...info,
      id: request.params.id,
      dbPath: '',
      memberAvatar: null,
      aiConversationCount: 0,
    }
  })

  server.delete<{ Params: { id: string } }>('/_web/sessions/:id', async (request, reply) => {
    const { id } = request.params
    try {
      dbManager.close(id)
      const dbPath = dbManager.getDbPath(id)
      const fs = await import('fs')
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath)
        return { success: true }
      }
      return reply.code(404).send({ success: false, error: 'File not found' })
    } catch (err) {
      return reply.code(500).send({ success: false, error: String(err) })
    }
  })

  server.patch<{ Params: { id: string }; Body: { name: string } }>('/_web/sessions/:id/name', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const { name } = request.body
    db.prepare('UPDATE meta SET name = ?').run(name)
    return { success: true }
  })

  server.patch<{ Params: { id: string }; Body: { ownerId: string | null } }>(
    '/_web/sessions/:id/owner',
    async (request) => {
      const db = ensureDb(dbManager, request.params.id)
      const { ownerId } = request.body
      db.prepare('UPDATE meta SET owner_id = ?').run(ownerId ?? null)
      return { success: true }
    }
  )

  // ==================== 时间范围 ====================

  server.get<{ Params: { id: string } }>('/_web/sessions/:id/years', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    return getAvailableYears(db)
  })

  server.get<{ Params: { id: string } }>('/_web/sessions/:id/time-range', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    return getTimeRange(db)
  })

  // ==================== 统计分析 ====================

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/stats/member-activity', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getMemberActivity(db, filter)
  })

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/stats/hourly', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getHourlyActivity(db, filter)
  })

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/stats/daily', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getDailyActivity(db, filter)
  })

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/stats/weekday', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getWeekdayActivity(db, filter)
  })

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/stats/message-types', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getMessageTypeStats(db, filter)
  })

  // ==================== 成员管理 ====================

  server.get<{ Params: { id: string } }>('/_web/sessions/:id/members', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    return getMembersWithAliases(db)
  })

  server.get<{
    Params: { id: string }
    Querystring: { page?: string; pageSize?: string; search?: string; sortOrder?: string }
  }>('/_web/sessions/:id/members/paginated', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const result = getMembersPaginated(db, {
      page: parseInt(request.query.page || '1', 10),
      pageSize: parseInt(request.query.pageSize || '20', 10),
      search: request.query.search,
      sortOrder: request.query.sortOrder === 'asc' ? 'asc' : 'desc',
    })
    return {
      items: result.members,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    }
  })

  server.patch<{ Params: { id: string; memberId: string }; Body: { aliases: string[] } }>(
    '/_web/sessions/:id/members/:memberId/aliases',
    async (request) => {
      const db = ensureDb(dbManager, request.params.id)
      const memberId = parseInt(request.params.memberId, 10)
      const { aliases } = request.body
      db.prepare('UPDATE member SET aliases = ? WHERE id = ?').run(JSON.stringify(aliases), memberId)
      return { success: true }
    }
  )

  server.delete<{ Params: { id: string; memberId: string } }>(
    '/_web/sessions/:id/members/:memberId',
    async (request) => {
      const db = ensureDb(dbManager, request.params.id)
      const memberId = parseInt(request.params.memberId, 10)
      db.prepare('DELETE FROM message WHERE sender_id = ?').run(memberId)
      db.prepare('DELETE FROM member WHERE id = ?').run(memberId)
      return { success: true }
    }
  )

  server.post<{ Params: { id: string }; Body: { memberId1: number; memberId2: number } }>(
    '/_web/sessions/:id/members/merge',
    async (request) => {
      const db = ensureDb(dbManager, request.params.id)
      const { memberId1, memberId2 } = request.body
      db.prepare('UPDATE message SET sender_id = ? WHERE sender_id = ?').run(memberId1, memberId2)
      db.prepare('DELETE FROM member WHERE id = ?').run(memberId2)
      return { success: true }
    }
  )

  server.get<{ Params: { id: string; memberId: string } }>(
    '/_web/sessions/:id/members/:memberId/history',
    async (request) => {
      const db = ensureDb(dbManager, request.params.id)
      const memberId = parseInt(request.params.memberId, 10)

      const rows = db
        .prepare(
          `SELECT
            sender_account_name as accountName,
            sender_group_nickname as groupNickname,
            MIN(ts) as startTs,
            MAX(ts) as endTs
          FROM message
          WHERE sender_id = ?
          GROUP BY sender_account_name, sender_group_nickname
          ORDER BY startTs`
        )
        .all(memberId) as any[]

      const history: Array<{ nameType: string; name: string; startTs: number; endTs: number | null }> = []
      for (const row of rows) {
        if (row.accountName) {
          history.push({ nameType: 'account_name', name: row.accountName, startTs: row.startTs, endTs: row.endTs })
        }
        if (row.groupNickname) {
          history.push({ nameType: 'group_nickname', name: row.groupNickname, startTs: row.startTs, endTs: row.endTs })
        }
      }
      return history
    }
  )

  // ==================== 高级分析（analytics） ====================

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/analytics/relationship', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getRelationshipStats(db, filter)
  })

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/analytics/catchphrase', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getCatchphraseAnalysis(db, filter)
  })

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/analytics/mention', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getMentionAnalysis(db, filter)
  })

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/analytics/mention-graph', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getMentionGraph(db, filter)
  })

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/analytics/laugh', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getLaughAnalysis(db, filter)
  })

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string; topEdges?: string }
  }>('/_web/sessions/:id/analytics/cluster', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    const topEdges = request.query.topEdges ? parseInt(request.query.topEdges, 10) : undefined
    return getClusterGraph(db, filter, topEdges ? { topEdges } : undefined)
  })

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string; locale?: string }
  }>('/_web/sessions/:id/analytics/language-preference', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    const locale = request.query.locale || 'zh-CN'
    const nlpProvider = createJiebaNlpProvider()
    return getLanguagePreferenceAnalysis(db, { locale, timeFilter: filter, nlpProvider })
  })

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/analytics/monthly-activity', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getMonthlyActivity(db, filter)
  })

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/analytics/yearly-activity', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getYearlyActivity(db, filter)
  })

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/analytics/message-length-distribution', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getMessageLengthDistribution(db, filter)
  })

  // ==================== SQL Lab ====================

  server.post<{ Params: { id: string }; Body: { sql: string } }>('/_web/sessions/:id/sql', async (request, reply) => {
    const db = ensureDb(dbManager, request.params.id)
    const { sql } = request.body || {}
    if (!sql || typeof sql !== 'string') {
      return reply.code(400).send({ error: 'Missing sql parameter' })
    }
    try {
      return executeSql(db, sql, { timing: true })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'SQL execution error'
      return reply.code(400).send({ error: message })
    }
  })

  server.get<{ Params: { id: string } }>('/_web/sessions/:id/schema', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    return getSchemaDetailed(db)
  })

  // ==================== 插件查询（参数化只读 SQL） ====================

  server.post<{
    Params: { id: string }
    Body: { sql: string; params?: unknown[] | Record<string, unknown> }
  }>('/_web/sessions/:id/query', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const { sql, params = [] } = request.body as { sql: string; params?: unknown[] | Record<string, unknown> }

    if (!sql || typeof sql !== 'string') {
      throw Object.assign(new Error('Missing or invalid "sql" field'), { statusCode: 400 })
    }

    const stmt = db.prepare(sql.trim())

    if (!stmt.readonly) {
      throw Object.assign(new Error('Only READ-ONLY statements are allowed'), { statusCode: 403 })
    }

    if (Array.isArray(params)) {
      return stmt.all(...params)
    }
    return stmt.all(params)
  })

  // ==================== 导出 ====================

  server.post<{
    Params: { id: string }
    Body: {
      sessionName: string
      filterMode: 'condition' | 'session'
      keywords?: string[]
      timeFilter?: { startTs: number; endTs: number }
      senderIds?: number[]
      contextSize?: number
      chatSessionIds?: number[]
    }
  }>('/_web/sessions/:id/export/markdown', async (request, reply) => {
    const { id } = request.params
    const body = request.body as any
    const sessionName = body?.sessionName || id

    const chunks: string[] = []
    const result = exportFilterResultToMarkdown(
      {
        sessionId: id,
        sessionName,
        filterMode: body.filterMode || 'condition',
        keywords: body.keywords,
        timeFilter: body.timeFilter,
        senderIds: body.senderIds,
        contextSize: body.contextSize,
        chatSessionIds: body.chatSessionIds,
      },
      {
        openDatabase(sessionId: string) {
          return dbManager.open(sessionId) ?? null
        },
      },
      {
        write(chunk: string) {
          chunks.push(chunk)
        },
        end() {
          /* collected in chunks array */
        },
      }
    )

    if (!result.success) {
      return reply.code(500).send({ error: result.error })
    }

    reply.header('Content-Type', 'text/markdown; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(sessionName)}_export.md"`)
    return reply.send(chunks.join(''))
  })

  // ==================== 会话索引 ====================

  server.post<{
    Params: { id: string }
    Body: { gapThreshold?: number }
  }>('/_web/sessions/:id/generate-index', async (request) => {
    const db = ensureWritableDb(dbManager, request.params.id)
    const gapThreshold = (request.body as any)?.gapThreshold ?? 1800
    const sessionCount = generateSessionIndex(db, gapThreshold)
    return { sessionCount }
  })

  server.post<{ Params: { id: string } }>('/_web/sessions/:id/clear-index', async (request) => {
    const db = ensureWritableDb(dbManager, request.params.id)
    clearSessionIndex(db)
    return { success: true }
  })

  // ==================== FTS Search & Rebuild ====================

  server.get<{
    Params: { id: string }
    Querystring: { keywords: string; limit?: string; offset?: string }
  }>('/_web/sessions/:id/search/fts', async (request, reply) => {
    const db = ensureDb(dbManager, request.params.id)
    if (!hasFtsTable(db)) {
      return reply.code(400).send({ error: 'FTS index not built for this session' })
    }
    const keywords = request.query.keywords.split(/\s+/).filter(Boolean)
    if (keywords.length === 0) return { rowids: [], total: 0 }
    const limit = parseInt(request.query.limit || '100', 10)
    const offset = parseInt(request.query.offset || '0', 10)
    return searchByFts(db, keywords, limit, offset)
  })

  server.get<{ Params: { id: string } }>('/_web/sessions/:id/fts/status', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    return { hasFtsIndex: hasFtsTable(db) }
  })

  server.post<{ Params: { id: string } }>('/_web/sessions/:id/fts/rebuild', async (request) => {
    const db = ensureWritableDb(dbManager, request.params.id)
    const result = rebuildFtsIndex(db)
    return { success: true, indexed: result.indexed }
  })

  // ==================== Session Summary (LLM-generated) ====================

  server.post<{
    Params: { id: string }
    Body: { chatSessionId: number; locale?: string; forceRegenerate?: boolean }
  }>('/_web/sessions/:id/summaries/generate', async (request, reply) => {
    const sessionId = request.params.id
    const { chatSessionId, locale, forceRegenerate } = request.body

    const aiDataDir = getAiDataDir(dbManager)
    const llmConfig = getDefaultAssistantConfig(aiDataDir)
    if (!llmConfig) {
      return reply.code(400).send({ error: 'No LLM configuration available' })
    }

    const db = ensureWritableDb(dbManager, sessionId)
    const deps = buildSummaryDeps(db, llmConfig, aiDataDir)

    const result = await generateSessionSummary(deps, chatSessionId, { locale, forceRegenerate })
    return result
  })

  server.post<{
    Params: { id: string }
    Body: { locale?: string; forceRegenerate?: boolean }
  }>('/_web/sessions/:id/summaries/generate-all', async (request, reply) => {
    const sessionId = request.params.id
    const { locale, forceRegenerate } = request.body

    const aiDataDir = getAiDataDir(dbManager)
    const llmConfig = getDefaultAssistantConfig(aiDataDir)
    if (!llmConfig) {
      return reply.code(400).send({ error: 'No LLM configuration available' })
    }

    const db = ensureWritableDb(dbManager, sessionId)
    const chatSessions = getChatSessionList(db)
    const deps = buildSummaryDeps(db, llmConfig, aiDataDir)

    let success = 0
    let failed = 0

    for (const cs of chatSessions) {
      const result = await generateSessionSummary(deps, cs.id, { locale, forceRegenerate })
      if (result.success) success++
      else failed++
    }

    return { success, failed, total: chatSessions.length }
  })

  // ==================== Demo 示例数据 ====================

  const DEMO_BASE_URL = 'https://chatlab.fun/assets/demo'

  server.post<{ Body: { locale?: string } }>('/_web/demo/import', async (request, reply) => {
    const locale = (request.body as any)?.locale || 'en'
    const nativeBinding = resolveNativeBinding()

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    function sendEvent(event: string, data: unknown) {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-demo-'))
    const groupPath = path.join(tmpDir, 'demo-group.json')
    const privatePath = path.join(tmpDir, 'demo-private.json')

    try {
      sendEvent('progress', { stage: 'downloading', current: 1, total: 2 })
      const groupResp = await fetch(`${DEMO_BASE_URL}/${locale}/demo-group.json`, {
        signal: AbortSignal.timeout(60_000),
      })
      if (!groupResp.ok) throw new Error(`Download group demo failed: ${groupResp.status}`)
      fs.writeFileSync(groupPath, Buffer.from(await groupResp.arrayBuffer()))

      sendEvent('progress', { stage: 'downloading', current: 2, total: 2 })
      const privateResp = await fetch(`${DEMO_BASE_URL}/${locale}/demo-private.json`, {
        signal: AbortSignal.timeout(60_000),
      })
      if (!privateResp.ok) throw new Error(`Download private demo failed: ${privateResp.status}`)
      fs.writeFileSync(privatePath, Buffer.from(await privateResp.arrayBuffer()))

      sendEvent('progress', { stage: 'importing', current: 1, total: 2 })
      const groupResult = await streamImport(dbManager, groupPath, { nativeBinding })

      if (!groupResult.success) throw new Error(groupResult.error || 'Failed to import group demo')

      sendEvent('progress', { stage: 'importing', current: 2, total: 2 })
      const privateResult = await streamImport(dbManager, privatePath, { nativeBinding })

      if (!privateResult.success) throw new Error(privateResult.error || 'Failed to import private demo')

      sendEvent('progress', { stage: 'done', current: 2, total: 2 })
      sendEvent('result', {
        success: true,
        groupSessionId: groupResult.sessionId,
        privateSessionId: privateResult.sessionId,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      sendEvent('progress', { stage: 'error', current: 0, total: 2, message })
      sendEvent('result', { success: false, error: message })
    } finally {
      try {
        fs.unlinkSync(groupPath)
      } catch {
        /* ignore */
      }
      try {
        fs.unlinkSync(privatePath)
      } catch {
        /* ignore */
      }
      try {
        fs.rmdirSync(tmpDir)
      } catch {
        /* ignore */
      }
      reply.raw.end()
    }
  })

  // ==================== 导入管线 ====================

  server.get('/_web/supported-formats', async () => {
    return getSupportedFormats()
  })

  server.post('/_web/detect-format', async (request, reply) => {
    const data = await (request as any).file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-detect-'))
    const tmpPath = path.join(tmpDir, data.filename || 'upload')

    try {
      const chunks: Buffer[] = []
      for await (const chunk of data.file) {
        chunks.push(chunk)
      }
      fs.writeFileSync(tmpPath, Buffer.concat(chunks))

      const format = detectFormat(tmpPath)
      const allFormats = detectAllFormats(tmpPath)
      return { format, allFormats }
    } finally {
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        /* ignore */
      }
      try {
        fs.rmdirSync(tmpDir)
      } catch {
        /* ignore */
      }
    }
  })

  server.post('/_web/scan-multi-chat', async (request, reply) => {
    const data = await (request as any).file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-scan-'))
    const tmpPath = path.join(tmpDir, data.filename || 'upload')

    try {
      const chunks: Buffer[] = []
      for await (const chunk of data.file) {
        chunks.push(chunk)
      }
      fs.writeFileSync(tmpPath, Buffer.concat(chunks))

      const chats = await scanMultiChatFile(tmpPath)
      return { chats }
    } finally {
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        /* ignore */
      }
      try {
        fs.rmdirSync(tmpDir)
      } catch {
        /* ignore */
      }
    }
  })

  server.post('/_web/import', async (request, reply) => {
    const data = await (request as any).file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-import-'))
    const tmpPath = path.join(tmpDir, data.filename || 'upload')

    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk)
    }
    fs.writeFileSync(tmpPath, Buffer.concat(chunks))

    const formatId = (data.fields?.formatId as any)?.value as string | undefined
    const chatIndexStr = (data.fields?.chatIndex as any)?.value as string | undefined
    const chatIndex = chatIndexStr !== undefined ? parseInt(chatIndexStr, 10) : undefined

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    function sendEvent(event: string, data: unknown) {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      const nativeBinding = resolveNativeBinding()
      const result = await streamImport(dbManager, tmpPath, {
        formatId,
        chatIndex,
        nativeBinding,
        onProgress: (p) => {
          sendEvent('progress', p)
        },
      })

      if (result.success) {
        sendEvent('done', {
          success: true,
          sessionId: result.sessionId,
          messageCount: result.diagnostics?.messagesWritten ?? 0,
          memberCount: 0,
        })
      } else {
        sendEvent('error', { success: false, error: result.error })
      }
    } catch (err) {
      sendEvent('error', { success: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      reply.raw.end()
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        /* ignore */
      }
      try {
        fs.rmdirSync(tmpDir)
      } catch {
        /* ignore */
      }
    }
  })

  // ==================== Directory Import ====================

  server.post('/_web/import-directory', async (request, reply) => {
    const parts = (request as any).parts()
    if (!parts) return reply.code(400).send({ error: 'No files uploaded' })

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-dir-import-'))

    // Interleaved fields: relativePaths (field) and files (file) come in order
    const relativePaths: string[] = []
    const fileBuffers: { data: Buffer; filename: string }[] = []

    try {
      for await (const part of parts) {
        if (part.type === 'field' && part.fieldname === 'relativePaths') {
          relativePaths.push(String(part.value))
        } else if (part.type === 'file') {
          const chunks: Buffer[] = []
          for await (const chunk of part.file) {
            chunks.push(chunk)
          }
          fileBuffers.push({ data: Buffer.concat(chunks), filename: part.filename || '' })
        }
      }

      // Write files preserving directory structure
      for (let i = 0; i < fileBuffers.length; i++) {
        let relPath = relativePaths[i] || fileBuffers[i].filename || `file_${i}`

        // Strip top-level directory from webkitRelativePath (e.g. "export_dir/chunks/..." → "chunks/...")
        const segments = relPath.split('/')
        if (segments.length > 1) {
          relPath = segments.slice(1).join('/')
        }

        const targetPath = path.join(tmpDir, relPath)
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        fs.writeFileSync(targetPath, fileBuffers[i].data)
      }

      const entryPath = findEntryFileInDirectory(tmpDir)
      if (!entryPath) {
        return reply.code(400).send({ error: 'No recognizable import format found in directory' })
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      function sendEvent(event: string, eventData: unknown) {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(eventData)}\n\n`)
      }

      const nativeBinding = resolveNativeBinding()
      const result = await streamImport(dbManager, entryPath, {
        nativeBinding,
        onProgress: (p) => {
          sendEvent('progress', p)
        },
      })

      if (result.success) {
        sendEvent('done', {
          success: true,
          sessionId: result.sessionId,
          messageCount: result.diagnostics?.messagesWritten ?? 0,
          memberCount: 0,
        })
      } else {
        sendEvent('error', { success: false, error: result.error })
      }
    } catch (err) {
      if (!reply.raw.headersSent) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) })
      }
      reply.raw.write(
        `event: error\ndata: ${JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) })}\n\n`
      )
    } finally {
      reply.raw.end()
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  // ==================== Incremental Import ====================

  server.post<{ Params: { id: string } }>('/_web/sessions/:id/import/incremental', async (request, reply) => {
    const sessionId = request.params.id
    const data = await (request as any).file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-inc-'))
    const tmpPath = path.join(tmpDir, data.filename || 'upload')

    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk)
    }
    fs.writeFileSync(tmpPath, Buffer.concat(chunks))

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    function sendEvent(event: string, eventData: unknown) {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(eventData)}\n\n`)
    }

    try {
      const result = await incrementalImport(dbManager, sessionId, tmpPath, {
        onProgress: (p) => {
          sendEvent('progress', p)
        },
      })

      if (result.success) {
        sendEvent('done', result)
      } else {
        sendEvent('error', { success: false, error: result.error })
      }
    } catch (err) {
      sendEvent('error', { success: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      reply.raw.end()
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        /* ignore */
      }
      try {
        fs.rmdirSync(tmpDir)
      } catch {
        /* ignore */
      }
    }
  })

  server.post<{ Params: { id: string } }>('/_web/sessions/:id/import/incremental/analyze', async (request, reply) => {
    const sessionId = request.params.id
    const data = await (request as any).file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-analyze-'))
    const tmpPath = path.join(tmpDir, data.filename || 'upload')

    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk)
    }
    fs.writeFileSync(tmpPath, Buffer.concat(chunks))

    try {
      const result = await analyzeIncrementalImport(dbManager, sessionId, tmpPath)
      return result
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        /* ignore */
      }
      try {
        fs.rmdirSync(tmpDir)
      } catch {
        /* ignore */
      }
    }
  })

  // ==================== Analyze New Import (dry-run) ====================

  server.post('/_web/import/analyze', async (request, reply) => {
    const data = await (request as any).file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-analyze-'))
    const tmpPath = path.join(tmpDir, data.filename || 'upload')

    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk)
    }
    fs.writeFileSync(tmpPath, Buffer.concat(chunks))

    try {
      const result = await analyzeNewImport(tmpPath)
      return result
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        /* ignore */
      }
      try {
        fs.rmdirSync(tmpDir)
      } catch {
        /* ignore */
      }
    }
  })

  // ==================== 合并功能 ====================

  if (mergeCache) {
    server.post('/_web/merge/parse', async (request, reply) => {
      const data = await (request as any).file()
      if (!data) return reply.code(400).send({ error: 'No file uploaded' })

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-merge-'))
      const tmpPath = path.join(tmpDir, data.filename || 'upload')

      const chunks: Buffer[] = []
      for await (const chunk of data.file) {
        chunks.push(chunk)
      }
      fs.writeFileSync(tmpPath, Buffer.concat(chunks))

      try {
        const result = await streamParseFileInfo(tmpPath, {
          createTempDatabase(sourceFilePath: string) {
            return mergeCache.createTempDatabase(path.basename(sourceFilePath))
          },
          onProgress() {
            /* no-op for HTTP merge parse */
          },
        })

        const handle = mergeCache.store(data.filename || 'upload', result.tempDbPath)

        return {
          handle,
          name: result.name,
          format: result.format,
          platform: result.platform,
          messageCount: result.messageCount,
          memberCount: result.memberCount,
          fileSize: result.fileSize,
        }
      } finally {
        try {
          fs.unlinkSync(tmpPath)
        } catch {
          /* ignore */
        }
        try {
          fs.rmdirSync(tmpDir)
        } catch {
          /* ignore */
        }
      }
    })

    server.post<{ Body: { handles: string[] } }>('/_web/merge/conflicts', async (request, reply) => {
      const { handles } = request.body as { handles?: string[] }
      if (!handles || !Array.isArray(handles) || handles.length === 0) {
        return reply.code(400).send({ error: 'Missing or empty handles array' })
      }

      const readers: TempDbReader[] = []
      try {
        const dataSources: Array<{ source: import('@openchatlab/node-runtime').MergerDataSource; filename: string }> =
          []
        for (const handle of handles) {
          const entry = mergeCache.openReader(handle)
          if (!entry) return reply.code(404).send({ error: `Handle not found: ${handle}` })
          readers.push(entry.reader)
          dataSources.push({ source: entry.reader.toDataSource(), filename: entry.filename })
        }
        return checkConflictsFromSources(dataSources)
      } finally {
        for (const r of readers) r.close()
      }
    })

    server.post<{
      Body: { handles: string[]; outputName: string; format?: 'json' | 'jsonl'; andImport?: boolean }
    }>('/_web/merge/execute', async (request, reply) => {
      const { handles, outputName, format = 'json', andImport } = request.body as any
      if (!handles || !Array.isArray(handles) || handles.length === 0) {
        return reply.code(400).send({ error: 'Missing handles' })
      }
      if (!outputName) {
        return reply.code(400).send({ error: 'Missing outputName' })
      }

      const readers: TempDbReader[] = []
      try {
        const dataSources: Array<{ source: import('@openchatlab/node-runtime').MergerDataSource; filename: string }> =
          []
        for (const handle of handles) {
          const entry = mergeCache.openReader(handle)
          if (!entry) return reply.code(404).send({ error: `Handle not found: ${handle}` })
          readers.push(entry.reader)
          dataSources.push({ source: entry.reader.toDataSource(), filename: entry.filename })
        }

        const merged = buildMergedOutput(dataSources, outputName)

        let sessionId: string | undefined
        if (andImport) {
          const { streamImport: serverStreamImport } = await import('../../import/stream-import')
          const jsonData = JSON.stringify(merged.chatLabData)
          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-merged-'))
          const tmpPath = path.join(tmpDir, `${outputName}.json`)
          fs.writeFileSync(tmpPath, jsonData, 'utf-8')

          try {
            const importResult = await serverStreamImport(dbManager, tmpPath)
            sessionId = importResult.sessionId
          } finally {
            try {
              fs.unlinkSync(tmpPath)
            } catch {
              /* ignore */
            }
            try {
              fs.rmdirSync(tmpDir)
            } catch {
              /* ignore */
            }
          }
        }

        // Cleanup merge cache after successful merge
        for (const handle of handles) {
          mergeCache.delete(handle)
        }

        if (format === 'jsonl') {
          const lines: string[] = []
          for (const line of serializeChatLabToJsonl(merged.chatLabData)) {
            lines.push(line)
          }
          return { success: true, sessionId, data: lines.join('\n') }
        }

        return { success: true, sessionId, data: merged.chatLabData }
      } finally {
        for (const r of readers) r.close()
      }
    })

    server.post<{ Body: { handle?: string } }>('/_web/merge/clear', async (request) => {
      const { handle } = (request.body as any) || {}
      if (handle) {
        mergeCache.delete(handle)
      } else {
        mergeCache.clear()
      }
      return { success: true }
    })

    server.post<{
      Body: { sessionIds: string[] }
    }>('/_web/sessions/export-for-merge', async (request, reply) => {
      const { sessionIds } = request.body as { sessionIds?: string[] }
      if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
        return reply.code(400).send({ error: 'Missing sessionIds' })
      }

      const handles: Array<{ sessionId: string; handle: string }> = []
      for (const sid of sessionIds) {
        const db = dbManager.open(sid)
        if (!db) return reply.code(404).send({ error: `Session not found: ${sid}` })

        const exported = exportSessionToJson(db)
        const { db: tempDb, tempDbPath } = mergeCache.createTempDatabase(exported.meta.name)

        const { TempDbWriter } = await import('@openchatlab/node-runtime')
        const writer = new TempDbWriter(tempDb)
        writer.writeMeta({
          name: exported.meta.name,
          platform: exported.meta.platform,
          type: exported.meta.type,
          groupId: exported.meta.groupId,
          groupAvatar: exported.meta.groupAvatar,
        })
        writer.writeMembers(
          exported.members.map((m) => ({
            platformId: m.platformId,
            accountName: m.accountName,
            groupNickname: m.groupNickname,
            avatar: m.avatar,
          }))
        )
        writer.writeMessages(
          exported.messages.map((msg) => ({
            senderPlatformId: msg.sender,
            senderAccountName: msg.accountName,
            senderGroupNickname: msg.groupNickname,
            timestamp: msg.timestamp,
            type: msg.type,
            content: msg.content,
          }))
        )
        writer.finish()

        const handle = mergeCache.store(exported.meta.name, tempDbPath)
        handles.push({ sessionId: sid, handle })
      }

      return { success: true, handles }
    })
  }

  // ==================== Cache / File Operations ====================

  const downloadsDir = options?.pathProvider?.getDownloadsDir() || path.join(os.homedir(), 'Downloads')

  server.post<{
    Body: { filename: string; dataUrl: string }
  }>('/_web/cache/save-to-downloads', async (request) => {
    const { filename, dataUrl } = request.body
    if (!filename || !dataUrl) {
      return { success: false, error: 'filename and dataUrl are required' }
    }

    const base64Prefix = dataUrl.indexOf(',')
    const base64Data = base64Prefix >= 0 ? dataUrl.slice(base64Prefix + 1) : dataUrl
    const buffer = Buffer.from(base64Data, 'base64')

    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true })
    }

    const filePath = path.join(downloadsDir, filename)
    fs.writeFileSync(filePath, buffer)

    return { success: true, filePath }
  })

  server.post<{
    Body: { filePath: string }
  }>('/_web/cache/show-in-folder', async (request) => {
    const { filePath } = request.body
    if (!filePath) {
      return { success: false, error: 'filePath is required' }
    }

    const { exec } = await import('child_process')
    const platform = process.platform
    const dir = path.dirname(filePath)

    if (platform === 'darwin') {
      exec(`open -R "${filePath}"`)
    } else if (platform === 'win32') {
      exec(`explorer /select,"${filePath}"`)
    } else {
      exec(`xdg-open "${dir}"`)
    }

    return { success: true }
  })
}
