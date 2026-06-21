/**
 * 证据检索工具 retrieve_chat_evidence
 *
 * 面向“多少次 / 有没有 / 是否曾经 / 给证据链”这类历史事实判断问题：
 * 同时（或按 mode）跑语义召回与关键词召回，合并去重并保守分组，
 * 产出可持久化、已脱敏的结构化证据 payload（data.evidence）和给 LLM 的安全摘要文本。
 *
 * 单位约定：聊天库 / RawMessage.timestamp 为秒；evidence payload 统一毫秒。
 * 关键词路径必须在工具层按时间范围兜底过滤（CLI provider 不保证时间过滤生效）。
 */

import type {
  ChatEvidenceGroup,
  ChatEvidencePayload,
  ChatEvidenceSource,
  EvidencePayloadStatus,
  EvidenceRetrievalMode,
  EvidenceStatus,
  EvidenceTimeRangeMs,
  EvidenceWarning,
  JsonSchema,
  RawMessage,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from '../types'
import { SEMANTIC_SEARCH_MAX_RESULTS_HARD_CAP } from '../types'
import { timeParamProperties } from '../utils/schemas'

const EVIDENCE_GROUP_GAP_SECONDS = 2 * 60 * 60
const EVIDENCE_GROUP_GAP_MS = EVIDENCE_GROUP_GAP_SECONDS * 1000
const EVIDENCE_GROUP_MAX_SOURCES = 5
const EVIDENCE_SNIPPET_MAX_CHARS = 160
const KEYWORD_DEFAULT_LIMIT = 80

/** 计划/意向词：仅出现这些且无实际证据词，倾向判为“不计入” */
const PLANNING_WORDS = ['准备', '打算', '攻略', '想去', '计划', '要不要去', '考虑去', '安排一下']
/** 实际发生证据词：出现则倾向判为“计入” */
const EVIDENCE_WORDS = ['到了', '到达', '出发', '返程', '回来', '入住', '住了', '门票', '合影', '打卡', '玩了']

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: '需要用聊天证据确认的问题/检索目标，例如“我们去乐山旅行过多少次”。',
    },
    criteria: {
      type: 'string',
      description:
        '判定标准：什么算计入、什么不计入。统计/判断类问题应填写，例如“计入：有实际出行/到达/住宿证据；不计入：仅计划、攻略、别人经历、泛聊”。',
    },
    keywords: {
      type: 'array',
      items: { type: 'string' },
      description: '关键词列表，由你显式给出（工具不做同义词扩展）。hybrid/keyword 模式用于精确召回。',
    },
    mode: {
      type: 'string',
      enum: ['auto', 'hybrid', 'semantic', 'keyword'],
      description: 'auto(默认)/hybrid(语义+关键词)/semantic(仅语义)/keyword(仅关键词)。历史事实统计通常用 hybrid。',
    },
    max_results: {
      type: 'number',
      description: `语义路径期望返回片段数，硬上限 ${SEMANTIC_SEARCH_MAX_RESULTS_HARD_CAP}。`,
      minimum: 1,
      maximum: SEMANTIC_SEARCH_MAX_RESULTS_HARD_CAP,
    },
    ...timeParamProperties,
  },
  required: ['query'],
}

/** 内部统一候选 */
interface EvidenceCandidate {
  messageId: number
  startMessageId?: number
  endMessageId?: number
  timestamp: number // 毫秒
  rangeStartMs: number // 毫秒，用于时间交集
  rangeEndMs: number // 毫秒
  snippet: string
  senderName?: string
  sourceKind: 'semantic' | 'keyword'
  score?: number
}

function isChinese(locale?: string): boolean {
  return !locale || locale.toLowerCase().startsWith('zh')
}

function truncateSnippet(text: string): string {
  const t = text.trim()
  return t.length > EVIDENCE_SNIPPET_MAX_CHARS ? `${t.slice(0, EVIDENCE_SNIPPET_MAX_CHARS)}…` : t
}

/**
 * 语义 snippet 由预处理管道渲染为多行「时间 发送者: 内容」，时间对证据块展示是噪声
 * （分组已给出总时间）。这里去掉每行行首的时间前缀，仅保留「发送者: 内容」。
 * 覆盖 zh-CN（`2025/3/3 07:25:04`）与 en-US（`3/3/2025, 7:25:04 AM`）两种 toLocaleString 输出。
 */
const LINE_TIME_PREFIX = /^\s*\d{1,4}[/-]\d{1,2}[/-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?\s+/
function stripLineTimestamps(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(LINE_TIME_PREFIX, ''))
    .join('\n')
    .trim()
}

function parseDateMs(s?: unknown): number | undefined {
  if (typeof s !== 'string' || !s.trim()) return undefined
  const d = new Date(s.trim().replace(' ', 'T'))
  const t = d.getTime()
  return Number.isNaN(t) ? undefined : t
}

function parseIsoMs(s?: string): number | undefined {
  if (!s) return undefined
  const t = Date.parse(s)
  return Number.isNaN(t) ? undefined : t
}

/** 解析时间范围为毫秒（可单边）；显式参数优先，其次继承 context.timeFilter（秒→毫秒） */
function parseEvidenceTimeRange(
  params: Record<string, unknown>,
  context: ToolExecutionContext
): EvidenceTimeRangeMs | undefined {
  const startMs = parseDateMs(params.start_time)
  const endMs = parseDateMs(params.end_time)
  if (startMs != null || endMs != null) {
    return { startTs: startMs, endTs: endMs }
  }
  if (context.timeFilter) {
    return { startTs: context.timeFilter.startTs * 1000, endTs: context.timeFilter.endTs * 1000 }
  }
  return undefined
}

function overlapsTimeRangeMs(startMs: number, endMs: number, filter?: EvidenceTimeRangeMs): boolean {
  if (!filter) return true
  if (filter.startTs != null && endMs < filter.startTs) return false
  if (filter.endTs != null && startMs > filter.endTs) return false
  return true
}

function clampMaxResults(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(1, Math.min(SEMANTIC_SEARCH_MAX_RESULTS_HARD_CAP, Math.floor(value)))
}

function toKeywordTimeFilter(rangeMs: EvidenceTimeRangeMs | undefined): { startTs: number; endTs: number } | undefined {
  if (!rangeMs) return undefined
  const filter: { startTs?: number; endTs?: number } = {}
  if (rangeMs.startTs != null) filter.startTs = Math.floor(rangeMs.startTs / 1000)
  if (rangeMs.endTs != null) filter.endTs = Math.floor(rangeMs.endTs / 1000)
  return Object.keys(filter).length > 0 ? (filter as { startTs: number; endTs: number }) : undefined
}

interface ResolveResult {
  mode: Exclude<EvidenceRetrievalMode, 'auto'>
  warnings: Set<EvidenceWarning>
}

function resolveMode(
  requested: EvidenceRetrievalMode,
  semanticAvailable: boolean,
  hasKeywords: boolean
): ResolveResult {
  const warnings = new Set<EvidenceWarning>()
  if (requested !== 'auto') return { mode: requested, warnings }

  if (semanticAvailable && hasKeywords) return { mode: 'hybrid', warnings }
  if (semanticAvailable && !hasKeywords) {
    warnings.add('keywords_missing_for_hybrid')
    return { mode: 'semantic', warnings }
  }
  warnings.add('semantic_unavailable')
  if (!hasKeywords) warnings.add('keywords_required_for_keyword_mode')
  return { mode: 'keyword', warnings }
}

/** 关键词消息 → 候选（脱敏 + 时间兜底） */
function keywordMessagesToCandidates(
  messages: RawMessage[],
  rangeMs: EvidenceTimeRangeMs | undefined,
  desensitize: ToolExecutionContext['desensitizeMessages']
): EvidenceCandidate[] {
  const safe = desensitize ? desensitize(messages) : messages
  const candidates: EvidenceCandidate[] = []
  for (const m of safe) {
    if (m.id == null || !m.content) continue
    const tsMs = m.timestamp * 1000
    if (!overlapsTimeRangeMs(tsMs, tsMs, rangeMs)) continue
    candidates.push({
      messageId: m.id,
      timestamp: tsMs,
      rangeStartMs: tsMs,
      rangeEndMs: tsMs,
      snippet: truncateSnippet(m.content),
      senderName: m.senderName,
      sourceKind: 'keyword',
    })
  }
  return candidates
}

/** 合并去重：关键词命中的时间戳落在语义片段时间范围内则丢弃；按 messageId 去重；按时间排序 */
function mergeCandidates(semantic: EvidenceCandidate[], keyword: EvidenceCandidate[]): EvidenceCandidate[] {
  const keptKeyword = keyword.filter(
    (kc) => !semantic.some((sc) => kc.timestamp >= sc.rangeStartMs && kc.timestamp <= sc.rangeEndMs)
  )

  const byId = new Map<number, EvidenceCandidate>()
  for (const c of [...semantic, ...keptKeyword]) {
    if (!byId.has(c.messageId)) byId.set(c.messageId, c)
  }
  return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp)
}

function classifyGroup(snippets: string[], hasCriteria: boolean, locale?: string): EvidenceStatus {
  if (!hasCriteria) return 'uncertain'
  if (!isChinese(locale)) return 'uncertain'
  const joined = snippets.join('\n')
  const hasEvidence = EVIDENCE_WORDS.some((w) => joined.includes(w))
  const hasPlanning = PLANNING_WORDS.some((w) => joined.includes(w))
  if (hasEvidence) return 'included'
  if (hasPlanning) return 'excluded'
  return 'uncertain'
}

function formatDate(ms: number, locale?: string): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return isChinese(locale) ? `${y}年${m}月${day}日` : `${y}-${m}-${day}`
}

function buildGroups(candidates: EvidenceCandidate[], hasCriteria: boolean, locale?: string): ChatEvidenceGroup[] {
  const groups: ChatEvidenceGroup[] = []
  let current: ChatEvidenceGroup | null = null
  let lastTs = 0

  for (const c of candidates) {
    const source: ChatEvidenceSource = {
      messageId: c.messageId,
      startMessageId: c.startMessageId,
      endMessageId: c.endMessageId,
      timestamp: c.timestamp,
      senderName: c.senderName,
      snippet: c.snippet,
      sourceKind: c.sourceKind,
    }
    const continues =
      current && c.timestamp - lastTs <= EVIDENCE_GROUP_GAP_MS && current.sources.length < EVIDENCE_GROUP_MAX_SOURCES
    if (continues && current) {
      current.sources.push(source)
      current.timeRange = { startTs: current.timeRange!.startTs, endTs: c.timestamp }
    } else {
      current = {
        id: `g${groups.length + 1}`,
        status: 'uncertain',
        title: '',
        reason: '',
        timeRange: { startTs: c.timestamp, endTs: c.timestamp },
        sources: [source],
      }
      groups.push(current)
    }
    lastTs = c.timestamp
  }

  const cn = isChinese(locale)
  for (const g of groups) {
    const snippets = g.sources.map((s) => s.snippet)
    g.status = classifyGroup(snippets, hasCriteria, locale)
    const start = formatDate(g.timeRange!.startTs, locale)
    const end = formatDate(g.timeRange!.endTs, locale)
    g.title = start === end ? start : cn ? `${start} 至 ${end}` : `${start} – ${end}`
    g.reason = cn ? GROUP_REASON_CN[g.status] : GROUP_REASON_EN[g.status]
  }
  return groups
}

const GROUP_REASON_CN: Record<EvidenceStatus, string> = {
  included: '含实际发生/到达等证据，建议计入',
  excluded: '仅含计划/意向，未见实际发生证据，建议不计入',
  uncertain: '证据不足，无法确认是否计入',
}
const GROUP_REASON_EN: Record<EvidenceStatus, string> = {
  included: 'Contains concrete evidence of an actual event; suggest counting it.',
  excluded: 'Only plans/intentions without evidence of occurrence; suggest excluding.',
  uncertain: 'Insufficient evidence to confirm.',
}

function buildContent(payload: ChatEvidencePayload, locale: string | undefined): string {
  const cn = isChinese(locale)
  const lines: string[] = []
  lines.push(
    cn
      ? `证据检索结果（mode=${payload.mode}，status=${payload.status}）`
      : `Evidence (mode=${payload.mode}, status=${payload.status})`
  )
  if (payload.warnings && payload.warnings.length > 0) {
    lines.push((cn ? '告警: ' : 'Warnings: ') + payload.warnings.join(', '))
  }
  if (payload.groups.length === 0) {
    lines.push(cn ? '未找到可计入的明确证据。' : 'No conclusive evidence found.')
  }
  for (const g of payload.groups) {
    lines.push(`\n[${g.status}] ${g.title} — ${g.reason}`)
    for (const s of g.sources) {
      const who = s.senderName ? `${s.senderName}: ` : ''
      lines.push(`  · ${who}${s.snippet}`)
    }
  }
  lines.push(
    cn
      ? '\n请基于以上证据保守作答：只把 included 计入确定结论，excluded/uncertain 不计入；证据不足时回答”无法确认”。'
      : '\nAnswer conservatively: count `included` groups toward the conclusion; for `uncertain` groups, judge based on the snippet content whether evidence of actual occurrence is present; do not count `excluded` groups.'
  )
  return lines.join('\n')
}

function computeStatus(
  anyPathRan: boolean,
  hasResults: boolean,
  warnings: Set<EvidenceWarning>
): EvidencePayloadStatus {
  if (!anyPathRan) return 'unavailable'
  if (!hasResults) return 'empty'
  const degraded =
    warnings.has('semantic_partial') || warnings.has('semantic_unavailable') || warnings.has('keyword_unavailable')
  return degraded ? 'partial' : 'complete'
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const locale = context.locale
  const query = typeof params.query === 'string' ? params.query.trim() : ''
  const criteria = typeof params.criteria === 'string' && params.criteria.trim() ? params.criteria.trim() : undefined
  const keywords = Array.isArray(params.keywords)
    ? (params.keywords.filter((k) => typeof k === 'string' && k.trim()) as string[])
    : []
  const requestedMode: EvidenceRetrievalMode =
    params.mode === 'hybrid' || params.mode === 'semantic' || params.mode === 'keyword' || params.mode === 'auto'
      ? params.mode
      : 'auto'

  const service = context.semanticIndexService
  const semanticAvailable = !!service && service.canSearch(context.sessionId)
  const rangeMs = parseEvidenceTimeRange(params, context)

  const { mode, warnings } = resolveMode(requestedMode, semanticAvailable, keywords.length > 0)
  if (!criteria) warnings.add('criteria_missing')

  const runSemantic = mode === 'semantic' || mode === 'hybrid'
  const runKeyword = mode === 'keyword' || mode === 'hybrid'

  let semanticRan = false
  let keywordRan = false
  const semanticCandidates: EvidenceCandidate[] = []
  let keywordCandidates: EvidenceCandidate[] = []

  // 语义路径：service 内按 chunk 时间范围过滤；工具层再按 startTime/endTime 兜底过滤
  if (runSemantic) {
    if (!service || !semanticAvailable) {
      warnings.add('semantic_unavailable')
    } else {
      const result = await service.searchForTool(context.sessionId, query, {
        maxResults: clampMaxResults(params.max_results),
        preprocessConfig: context.preprocessConfig,
        ownerPlatformId: context.ownerPlatformId,
        locale,
        maxResultTokens: context.maxToolResultTokens,
        timeFilter: rangeMs,
      })
      semanticRan = true
      if (!result.available) {
        warnings.add('semantic_unavailable')
      } else {
        if (result.partial) warnings.add('semantic_partial')
        for (const s of result.sources) {
          const startMs = parseIsoMs(s.startTime)
          const endMs = parseIsoMs(s.endTime) ?? startMs
          if (rangeMs && startMs != null && endMs != null && !overlapsTimeRangeMs(startMs, endMs, rangeMs)) continue
          semanticCandidates.push({
            messageId: s.startMessageId,
            startMessageId: s.startMessageId,
            endMessageId: s.endMessageId,
            timestamp: startMs ?? 0,
            rangeStartMs: startMs ?? 0,
            rangeEndMs: endMs ?? startMs ?? 0,
            snippet: truncateSnippet(stripLineTimestamps(s.snippet)),
            sourceKind: 'semantic',
            score: s.score,
          })
        }
      }
    }
  }

  // 关键词路径
  if (runKeyword) {
    if (keywords.length === 0) {
      warnings.add(mode === 'keyword' ? 'keywords_required_for_keyword_mode' : 'keywords_missing_for_hybrid')
    } else if (!context.dataProvider) {
      warnings.add('keyword_unavailable')
    } else {
      const secFilter = toKeywordTimeFilter(rangeMs)
      const searchResult = await context.dataProvider.searchMessages(keywords, {
        timeFilter: secFilter,
        limit: context.maxMessagesLimit || KEYWORD_DEFAULT_LIMIT,
      })
      keywordRan = true
      keywordCandidates = keywordMessagesToCandidates(searchResult.messages, rangeMs, context.desensitizeMessages)
    }
  }

  const merged = mergeCandidates(semanticCandidates, keywordCandidates)
  const groups = buildGroups(merged, !!criteria, locale)

  const status = computeStatus(semanticRan || keywordRan, groups.length > 0, warnings)

  const payload: ChatEvidencePayload = {
    version: 1,
    query,
    criteria,
    mode,
    status,
    warnings: warnings.size > 0 ? [...warnings] : undefined,
    groups,
  }
  if (rangeMs) {
    payload.appliedTimeFilter = {
      startTs: rangeMs.startTs,
      endTs: rangeMs.endTs,
    }
  }

  const cn = isChinese(locale)
  payload.summary =
    groups.length === 0
      ? cn
        ? '未找到明确可计入的证据。'
        : 'No conclusive evidence found.'
      : cn
        ? `共 ${groups.length} 组候选证据。`
        : `${groups.length} candidate evidence group(s).`

  return { content: buildContent(payload, locale), data: { evidence: payload } }
}

export const retrieveChatEvidenceTool: ToolDefinition = {
  name: 'retrieve_chat_evidence',
  description:
    'Retrieve and assemble conservative, de-identified evidence from the CURRENT conversation for fact/occurrence/count questions (e.g. "how many times did we...", "did we ever...", "prove from chat history..."). Runs semantic + keyword retrieval, groups results, and returns a structured evidence payload. Prefer this over search_messages/semantic_search_current_chat for evidence-chain or counting questions.',
  inputSchema,
  handler,
  category: 'core',
  truncationStrategy: 'keep_first',
}
