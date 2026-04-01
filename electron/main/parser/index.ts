/**
 * Parser V2 - 模块入口
 * 三层架构：标准层、嗅探层、解析层
 */

import { FormatSniffer, createSniffer } from './sniffer'
import { formats } from './formats'
import { getFileSize } from './utils'
import type {
  ParseOptions,
  ParseEvent,
  ParseResult,
  ParseProgress,
  LogLevel,
  FormatFeature,
  Parser,
  ParsedMeta,
  ParsedMember,
  ParsedMessage,
  FormatDiagnosis,
  MultiChatInfo,
} from './types'

// ==================== 全局嗅探器实例 ====================

const sniffer = createSniffer()
sniffer.registerAll(formats)

// ==================== 公共 API ====================

/**
 * 检测文件格式
 * @param filePath 文件路径
 * @returns 格式特征，如果无法识别则返回 null
 */
export function detectFormat(filePath: string): FormatFeature | null {
  return sniffer.sniff(filePath)
}

/**
 * 检测所有匹配的文件格式（按优先级排序）
 * 用于 fallback 机制：当第一个格式解析失败时尝试下一个
 * @param filePath 文件路径
 * @returns 所有匹配的格式特征列表
 */
export function detectAllFormats(filePath: string): FormatFeature[] {
  return sniffer.sniffAll(filePath)
}

/**
 * 诊断文件格式
 * 当检测失败时，返回详细的诊断信息，帮助用户了解问题所在
 * @param filePath 文件路径
 * @returns 诊断结果，包含每个格式的匹配详情和建议
 */
export function diagnoseFormat(filePath: string): FormatDiagnosis {
  return sniffer.diagnose(filePath)
}

/**
 * 获取文件对应的解析器
 * @param filePath 文件路径
 * @returns 解析器实例，如果无法识别则返回 null
 */
export function getParser(filePath: string): Parser | null {
  return sniffer.getParser(filePath)
}

/**
 * 获取所有支持的格式
 */
export function getSupportedFormats(): FormatFeature[] {
  return sniffer.getSupportedFormats()
}

/**
 * 获取格式的预处理器（如果有）
 */
export function getPreprocessor(filePath: string) {
  const feature = sniffer.sniff(filePath)
  if (!feature) return null

  const module = formats.find((m) => m.feature.id === feature.id)
  return module?.preprocessor || null
}

/**
 * 扫描多聊天文件中的聊天列表
 * 自动检测格式并调用对应格式模块的 scanChats
 * @param filePath 文件路径
 * @returns 聊天列表，如果格式不支持多聊天则抛出错误
 */
export async function scanMultiChatFile(filePath: string): Promise<MultiChatInfo[]> {
  const feature = sniffer.sniff(filePath)
  if (!feature) {
    throw new Error(`无法识别文件格式: ${filePath}`)
  }

  if (!feature.multiChat) {
    throw new Error(`格式 "${feature.name}" 不是多聊天格式`)
  }

  const module = formats.find((m) => m.feature.id === feature.id)
  if (!module?.scanChats) {
    throw new Error(`格式 "${feature.name}" 声明了 multiChat 但未实现 scanChats`)
  }

  return module.scanChats(filePath)
}

/**
 * 检查文件是否需要预处理
 */
export function needsPreprocess(filePath: string): boolean {
  const preprocessor = getPreprocessor(filePath)
  if (!preprocessor) return false

  const fileSize = getFileSize(filePath)
  return preprocessor.needsPreprocess(filePath, fileSize)
}

/**
 * 流式解析文件
 * @param options 解析选项
 * @yields 解析事件流
 */
export async function* parseFile(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const parser = sniffer.getParser(options.filePath)
  if (!parser) {
    yield { type: 'error', data: new Error(`无法识别文件格式: ${options.filePath}`) }
    return
  }

  console.log(`[Parser V2] Using parser: ${parser.feature.name}`)
  yield* parser.parse(options)
}

/**
 * 使用指定格式解析文件（用于 fallback 机制）
 * @param formatId 格式 ID
 * @param options 解析选项
 * @yields 解析事件流
 */
export async function* parseFileWithFormat(
  formatId: string,
  options: ParseOptions
): AsyncGenerator<ParseEvent, void, unknown> {
  const parser = sniffer.getParserById(formatId)
  if (!parser) {
    yield { type: 'error', data: new Error(`未知的格式 ID: ${formatId}`) }
    return
  }

  console.log(`[Parser V2] Using parser (explicit): ${parser.feature.name}`)
  yield* parser.parse(options)
}

/**
 * 同步解析文件（收集所有事件为完整结果）
 * 适用于不需要流式处理的场景（如合并工具）
 * @param filePath 文件路径
 * @param onProgress 进度回调（可选）
 */
export async function parseFileSync(
  filePath: string,
  onProgress?: (progress: ParseProgress) => void
): Promise<ParseResult> {
  let meta: ParsedMeta | null = null
  const members: ParsedMember[] = []
  const messages: ParsedMessage[] = []

  for await (const event of parseFile({ filePath, onProgress })) {
    switch (event.type) {
      case 'meta':
        meta = event.data
        break
      case 'members':
        members.push(...event.data)
        break
      case 'messages':
        messages.push(...event.data)
        break
      case 'progress':
        onProgress?.(event.data)
        break
      case 'error':
        throw event.data
    }
  }

  if (!meta) {
    throw new Error('解析失败：未获取到元信息')
  }

  return { meta, members, messages }
}

/**
 * 解析文件获取基本信息（只统计，不返回完整消息）
 * 用于预览和合并工具
 */
export async function parseFileInfo(
  filePath: string,
  onProgress?: (progress: ParseProgress) => void
): Promise<{
  name: string
  format: string
  platform: string
  messageCount: number
  memberCount: number
  fileSize: number
}> {
  const feature = sniffer.sniff(filePath)
  if (!feature) {
    throw new Error(`无法识别文件格式: ${filePath}`)
  }

  let name = '未知群聊'
  let platform = feature.platform
  let messageCount = 0
  let memberCount = 0

  for await (const event of parseFile({ filePath, onProgress })) {
    switch (event.type) {
      case 'meta':
        name = event.data.name
        platform = event.data.platform
        break
      case 'members':
        memberCount += event.data.length
        break
      case 'messages':
        messageCount += event.data.length
        break
      case 'progress':
        onProgress?.(event.data)
        break
      case 'error':
        throw event.data
    }
  }

  // 获取文件大小
  const fs = await import('fs')
  const fileSize = fs.statSync(filePath).size

  return {
    name,
    format: feature.name,
    platform,
    messageCount,
    memberCount,
    fileSize,
  }
}

// ==================== 导出类型 ====================

export type {
  ParseOptions,
  ParseEvent,
  ParseResult,
  ParseProgress,
  FormatFeature,
  Parser,
  ParsedMeta,
  ParsedMember,
  ParsedMessage,
  FormatDiagnosis,
  MultiChatInfo,
}

// ==================== 导出嗅探器（高级用法） ====================

export { FormatSniffer, createSniffer }

// ==================== 导出工具函数 ====================

export { getFileSize, formatFileSize, parseTimestamp, isValidYear, createProgress, readFileHeadBytes } from './utils'

// ==================== 回调模式 API ====================

/**
 * 回调模式的解析选项
 */
export interface StreamParseCallbacks {
  onProgress: (progress: ParseProgress) => void
  onMeta: (meta: ParsedMeta) => void
  onMembers: (members: ParsedMember[]) => void
  onMessageBatch: (messages: ParsedMessage[]) => void
  /** 日志回调（可选） */
  onLog?: (level: LogLevel, message: string) => void
}

export interface StreamParseOptions extends StreamParseCallbacks {
  filePath: string
  batchSize?: number
  formatOptions?: Record<string, unknown>
}

/**
 * 回调模式的流式解析
 * 内部使用 AsyncGenerator，对外提供回调接口
 * @param filePath 文件路径
 * @param callbacks 回调选项
 * @param formatId 可选，指定格式 ID（用于 fallback 机制，跳过自动检测）
 */
export async function streamParseFile(
  filePath: string,
  callbacks: Omit<StreamParseOptions, 'filePath'>,
  formatId?: string
): Promise<void> {
  const { onProgress, onMeta, onMembers, onMessageBatch, onLog, batchSize = 5000, formatOptions } = callbacks

  // 根据是否指定 formatId 选择解析方式
  const generator = formatId
    ? parseFileWithFormat(formatId, { filePath, batchSize, formatOptions, onProgress, onLog })
    : parseFile({ filePath, batchSize, formatOptions, onProgress, onLog })

  for await (const event of generator) {
    switch (event.type) {
      case 'meta':
        onMeta(event.data)
        break
      case 'members':
        onMembers(event.data)
        break
      case 'messages':
        onMessageBatch(event.data)
        break
      case 'progress':
        onProgress(event.data)
        break
      case 'error':
        throw event.data
    }
  }
}
