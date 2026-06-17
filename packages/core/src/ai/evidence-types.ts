/**
 * 证据检索 payload 类型（平台无关，跨包共享）
 *
 * 由 retrieve_chat_evidence 工具产出，持久化到 AI 对话历史，并由前端证据块渲染。
 * 放在 core 以便 tools / node-runtime / 前端共享同一份定义，避免重复漂移。
 *
 * 单位约定：聊天库 / RawMessage.timestamp 为秒；evidence payload 统一使用毫秒。
 */

/** 证据检索模式 */
export type EvidenceRetrievalMode = 'auto' | 'hybrid' | 'semantic' | 'keyword'

/** 单组证据状态：计入 / 不计入 / 不确定 */
export type EvidenceStatus = 'included' | 'excluded' | 'uncertain'

/** 整个证据 payload 状态 */
export type EvidencePayloadStatus = 'complete' | 'partial' | 'empty' | 'unavailable'

/** 证据检索告警 */
export type EvidenceWarning =
  | 'criteria_missing'
  | 'keywords_missing_for_hybrid'
  | 'keywords_required_for_keyword_mode'
  | 'semantic_unavailable'
  | 'keyword_unavailable'
  | 'semantic_partial'

/**
 * 毫秒级、可单边的时间区间。
 *
 * 用于 evidence payload 与语义路径；单边区间表达“今年以来 / 截至某天”等查询。
 */
export interface EvidenceTimeRangeMs {
  startTs?: number
  endTs?: number
}

/** 单条证据来源（已脱敏，timestamp 为毫秒） */
export interface ChatEvidenceSource {
  /** 点击追溯锚点；语义 range source 默认用 startMessageId，关键词 source 用命中消息 id */
  messageId: number
  /** 范围来源起点；关键词 source 可与 messageId 相同 */
  startMessageId?: number
  /** 范围来源终点；关键词 source 可与 messageId 相同 */
  endMessageId?: number
  /** 毫秒时间戳 */
  timestamp: number
  senderName?: string
  snippet: string
  role?: 'primary' | 'supporting'
  sourceKind?: 'semantic' | 'keyword'
}

/** 一组证据 */
export interface ChatEvidenceGroup {
  id: string
  status: EvidenceStatus
  title: string
  reason: string
  /** 毫秒时间范围 */
  timeRange?: { startTs: number; endTs: number }
  sources: ChatEvidenceSource[]
}

/**
 * 证据 payload（持久化到 AI 对话历史，时间戳统一毫秒）。
 *
 * 只保存脱敏后的 snippet / 时间戳 / messageId / 分组元数据 / 查询上下文，
 * 不保存原始 rawMessages、整段上下文全文或 embedding 原文。
 */
export interface ChatEvidencePayload {
  version: 1
  query: string
  criteria?: string
  /** 已 resolve 的实际检索模式（不会是 auto） */
  mode: EvidenceRetrievalMode
  status: EvidencePayloadStatus
  summary?: string
  /** 实际生效的时间过滤（毫秒，可单边） */
  appliedTimeFilter?: {
    startTs?: number
    endTs?: number
    label?: string
  }
  warnings?: EvidenceWarning[]
  groups: ChatEvidenceGroup[]
}
