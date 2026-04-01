/** 单条脱敏规则 */
export interface DesensitizeRule {
  /** 唯一标识（预置规则用固定 id，自定义规则用 uuid） */
  id: string
  /** 显示名称 */
  label: string
  /** 正则表达式字符串（运行时 new RegExp(pattern, 'g')） */
  pattern: string
  /** 替换文本 */
  replacement: string
  /** 是否启用 */
  enabled: boolean
  /** 是否为预置规则（预置规则不可删除，仅可启用/禁用） */
  builtin: boolean
  /** 适用的 locale 列表（空数组表示通用） */
  locales: string[]
}

/** 预处理配置 */
export interface PreprocessConfig {
  /** 数据清洗：清理 XML 卡片消息等非纯文本内容（默认开启） */
  dataCleaning: boolean
  /** 合并连续发言（同发送者 + 时间间隔 < mergeWindowSeconds） */
  mergeConsecutive: boolean
  /** 合并窗口（秒），默认 180 */
  mergeWindowSeconds?: number
  /** 自定义黑名单关键词，包含任一关键词的消息将被整条过滤 */
  blacklistKeywords: string[]
  /** 智能去噪（过滤纯语气词、纯表情、系统占位符） */
  denoise: boolean
  /** 数据脱敏总开关 */
  desensitize: boolean
  /** 脱敏规则列表（预置 + 自定义，按优先级排序） */
  desensitizeRules: DesensitizeRule[]
  /** 昵称匿名化：用 U{id} 替代真实昵称，减少 AI 幻觉 */
  anonymizeNames: boolean
}

/** 预处理管道可接受的消息结构（兼容 SearchMessageResult / SessionMessagesResult.messages） */
export interface PreprocessableMessage {
  id?: number
  senderId?: number
  senderName: string
  senderPlatformId?: string
  content: string | null
  timestamp: number
  replyToMessageId?: string | null
}
