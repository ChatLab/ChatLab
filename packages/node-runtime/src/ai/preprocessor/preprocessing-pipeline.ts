/**
 * 预处理管道（统一实现）
 *
 * Electron 端和 Server 端共用的消息预处理管道核心逻辑：
 * rawMessages → preprocess → [anonymize] → format → truncate → text
 */

import type { PreprocessConfig, PreprocessableMessage, TruncationStrategy } from './types'
import { preprocessMessagesWithStats, type PreprocessLogger, type PreprocessStats } from './pipeline'
import {
  formatMessageCompact,
  anonymizeMessageNames,
  formatToolResultAsText,
  truncateFormattedMessages,
} from './format'
import { countTokens } from '../tokenizer'

export interface PreprocessingPipelineOptions {
  rawMessages: PreprocessableMessage[]
  preprocessConfig?: PreprocessConfig
  locale?: string
  anonymizeNames?: boolean
  ownerPlatformId?: string
  maxToolResultTokens?: number
  truncationStrategy?: TruncationStrategy
  /** rawMessages 之外的附加元数据（如 total、timeRange），会合并到输出 details */
  extraDetails?: Record<string, unknown>
  /** 可选的日志记录器，Electron 端注入 aiLogger 以记录管道统计信息 */
  logger?: PreprocessLogger
  /** 渲染 [#id] 引用前缀（CLI agent 格式）；默认关闭，不影响桌面 AI 输出 */
  includeMessageIds?: boolean
  /** 搜索命中 id 集合，命中条渲染为 [#id*]（需 includeMessageIds） */
  hitIds?: Iterable<number>
  /** 单条消息内容字符上限（对接 --max-chars）；0 关闭截断；缺省用管道默认 200 */
  maxContentChars?: number
}

/** 管道执行统计（预处理各步骤 + 渲染/截断结果） */
export interface PipelineStats extends PreprocessStats {
  /** 最终 text 中的可读条目数（合并/截断后） */
  renderedBlocks: number
  truncated: boolean
}

export interface PreprocessingPipelineResult {
  text: string
  details: Record<string, unknown>
  stats: PipelineStats
}

export function applyPreprocessingPipeline(options: PreprocessingPipelineOptions): PreprocessingPipelineResult {
  const {
    rawMessages,
    preprocessConfig,
    locale,
    anonymizeNames = false,
    ownerPlatformId,
    maxToolResultTokens,
    truncationStrategy = 'keep_last',
    extraDetails = {},
    logger,
    includeMessageIds = false,
    hitIds,
    maxContentChars,
  } = options

  const { messages: processed, stats: preprocessStats } = preprocessMessagesWithStats(
    rawMessages,
    preprocessConfig,
    logger
  )

  let nameMapLine = ''
  if (anonymizeNames) {
    nameMapLine = anonymizeMessageNames(processed, ownerPlatformId)
  }

  const formatOptions =
    includeMessageIds || maxContentChars != null
      ? {
          includeMessageId: includeMessageIds,
          hitIds: hitIds ? new Set(hitIds) : undefined,
          maxContentLength: maxContentChars,
        }
      : undefined

  let formatted = processed.map((m) => formatMessageCompact(m, locale, formatOptions))

  let wasTruncated = false
  const originalCount = formatted.length

  if (maxToolResultTokens && maxToolResultTokens > 0) {
    const truncResult = truncateFormattedMessages(formatted, maxToolResultTokens, truncationStrategy, countTokens)
    if (truncResult.wasTruncated) {
      formatted = truncResult.messages
      wasTruncated = true
    }
  }

  const finalDetails: Record<string, unknown> = { ...extraDetails, messages: formatted, returned: formatted.length }

  let textContent = formatToolResultAsText(finalDetails)

  if (wasTruncated) {
    const strategyDesc = truncationStrategy === 'keep_first' ? 'most relevant' : 'most recent'
    const notice = `⚠️ Results truncated: ${originalCount} messages found, showing ${formatted.length} ${strategyDesc} due to context limit. Use a narrower time range or more specific keywords for more precise results.`
    textContent = notice + '\n' + textContent
  }

  if (nameMapLine) {
    textContent = nameMapLine + '\n' + textContent
  }

  const stats: PipelineStats = {
    ...preprocessStats,
    renderedBlocks: formatted.length,
    truncated: wasTruncated,
  }

  return { text: textContent, details: finalDetails, stats }
}
