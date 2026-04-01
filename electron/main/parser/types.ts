/**
 * Parser V2 - 类型定义
 * 三层架构：标准层、嗅探层、解析层
 */

import type { ChatPlatform, ChatType, ParsedMember, ParsedMessage } from '../../../src/types/base'

// ==================== 标准层：统一输出结构 ====================

/**
 * 解析的元信息
 */
export interface ParsedMeta {
  name: string
  platform: ChatPlatform
  type: ChatType
  groupId?: string // 群ID（群聊类型有值）
  groupAvatar?: string // 群头像（base64 Data URL）
  ownerId?: string // 所有者/导出者的 platformId
}

/**
 * 解析进度
 */
export interface ParseProgress {
  /** 阶段 */
  // 导入流程会复用解析进度结构，因此这里补充导入阶段枚举。
  stage: 'detecting' | 'parsing' | 'importing' | 'saving' | 'done' | 'error'
  /** 已读取字节数 */
  bytesRead: number
  /** 文件总字节数 */
  totalBytes: number
  /** 已处理消息数 */
  messagesProcessed: number
  /** 百分比 0-100 */
  percentage: number
  /** 状态消息 */
  message: string
}

/**
 * 解析事件（AsyncGenerator 输出）
 */
export type ParseEvent =
  | { type: 'meta'; data: ParsedMeta }
  | { type: 'members'; data: ParsedMember[] }
  | { type: 'messages'; data: ParsedMessage[] }
  | { type: 'progress'; data: ParseProgress }
  | { type: 'done'; data: { messageCount: number; memberCount: number } }
  | { type: 'error'; data: Error }

/**
 * 完整解析结果（用于同步收集）
 */
export interface ParseResult {
  meta: ParsedMeta
  members: ParsedMember[]
  messages: ParsedMessage[]
}

// ==================== 嗅探层：特征定义 ====================

/**
 * 格式特征签名
 */
export interface FormatSignatures {
  /** 文件头正则匹配（任意一个匹配即可） */
  head?: RegExp[]
  /** 文件名正则匹配（任意一个匹配即可，作为文件头匹配的补充） */
  filename?: RegExp[]
  /** 必须存在的 JSON 字段路径 */
  requiredFields?: string[]
  /** 字段值模式匹配 */
  fieldPatterns?: Record<string, RegExp>
}

/**
 * 格式特征定义
 */
export interface FormatFeature {
  /** 唯一标识符 */
  id: string
  /** 显示名称 */
  name: string
  /** 平台 */
  platform: ChatPlatform
  /** 优先级（数字越小越优先） */
  priority: number
  /** 支持的文件扩展名 */
  extensions: string[]
  /** 内容特征签名 */
  signatures: FormatSignatures
  /** 是否为多聊天格式（一个文件包含多个聊天） */
  multiChat?: boolean
}

// ==================== 解析层：解析器接口 ====================

/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * 解析选项
 */
export interface ParseOptions {
  /** 文件路径 */
  filePath: string
  /** 每批消息数量（默认 5000） */
  batchSize?: number
  /** 格式特定的额外选项（如 Telegram 的 chatIndex） */
  formatOptions?: Record<string, unknown>
  /** 进度回调（可选，用于外部监听） */
  onProgress?: (progress: ParseProgress) => void
  /** 日志回调（可选，用于记录解析过程中的信息、警告、错误） */
  onLog?: (level: LogLevel, message: string) => void
}

/**
 * 解析器接口
 * 使用 AsyncGenerator 实现渐进式输出
 */
export interface Parser {
  /** 关联的格式特征 */
  readonly feature: FormatFeature

  /**
   * 解析文件
   * @param options 解析选项
   * @yields 解析事件流
   */
  parse(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown>
}

/**
 * 预处理器接口
 * 用于大文件预处理，移除冗余字段
 */
export interface Preprocessor {
  /** 是否需要预处理 */
  needsPreprocess(filePath: string, fileSize: number): boolean
  /** 执行预处理，返回临时文件路径 */
  preprocess(filePath: string, onProgress?: (progress: ParseProgress) => void): Promise<string>
  /** 清理临时文件 */
  cleanup(tempPath: string): void
}

// ==================== 多聊天支持 ====================

/**
 * 多聊天文件中单个聊天的信息
 * 用于「一个文件包含多个聊天」的格式（如 Telegram 官方导出）
 */
export interface MultiChatInfo {
  /** 在源文件中的索引 */
  index: number
  /** 聊天名称 */
  name: string
  /** 聊天类型（平台特定的原始类型字符串） */
  type: string
  /** 聊天 ID */
  id: number
  /** 消息数量 */
  messageCount: number
}

/**
 * 格式模块导出结构
 * 每个格式文件同时导出 feature、parser，以及可选的 preprocessor 和 scanChats
 */
export interface FormatModule {
  feature: FormatFeature
  parser: Parser
  preprocessor?: Preprocessor
  /** 扫描多聊天文件中的聊天列表（仅 multiChat 格式需要实现） */
  scanChats?: (filePath: string) => Promise<MultiChatInfo[]>
}

// ==================== 诊断结果类型 ====================

/**
 * 单个格式的匹配检查结果
 */
export interface FormatMatchCheck {
  /** 格式 ID */
  formatId: string
  /** 格式显示名称 */
  formatName: string
  /** 扩展名是否匹配 */
  extensionMatch: boolean
  /** 文件头签名是否匹配（如果定义了） */
  headSignatureMatch: boolean | null
  /** 必需字段是否匹配（如果定义了） */
  requiredFieldsMatch: boolean | null
  /** 缺失的必需字段（如果有） */
  missingFields: string[]
  /** 是否完全匹配 */
  fullMatch: boolean
}

/**
 * 格式诊断结果
 */
export interface FormatDiagnosis {
  /** 是否成功识别到格式 */
  recognized: boolean
  /** 识别到的格式（如果有） */
  matchedFormat: FormatFeature | null
  /** 所有格式的检查详情 */
  checks: FormatMatchCheck[]
  /** 部分匹配的格式（扩展名匹配但内容不匹配） */
  partialMatches: FormatMatchCheck[]
  /** 诊断建议信息 */
  suggestion: string
}

// ==================== 工具类型 ====================

/**
 * 创建进度对象的工具函数类型
 */
export type CreateProgress = (
  stage: ParseProgress['stage'],
  bytesRead: number,
  totalBytes: number,
  messagesProcessed: number,
  message: string
) => ParseProgress

// 重新导出共享类型
export type { ParsedMember, ParsedMessage, ChatPlatform, ChatType }

/**
 * 获取显示名称
 * 优先使用群昵称，否则使用账号名称，最后使用平台ID
 */
export function getDisplayName(
  groupNickname: string | null | undefined,
  accountName: string | null | undefined,
  platformId: string
): string {
  return groupNickname || accountName || platformId
}
