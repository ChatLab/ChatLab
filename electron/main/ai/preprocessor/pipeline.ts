/**
 * 预处理管道
 * 执行顺序：数据清洗 → 黑名单 → 去噪 → 合并 → 脱敏
 */

import type { PreprocessConfig, PreprocessableMessage, DesensitizeRule } from './types'
import { aiLogger } from '../logger'

const MERGE_WINDOW_DEFAULT = 180

/**
 * 对消息数组执行预处理管道
 */
export function preprocessMessages<T extends PreprocessableMessage>(messages: T[], config?: PreprocessConfig): T[] {
  if (!config || !hasAnyEnabled(config)) return messages
  if (messages.length === 0) return messages

  const inputCount = messages.length
  let result: T[] = [...messages]
  const applied: string[] = []

  if (config.dataCleaning !== false) {
    const cleaned = applyDataCleaning(result)
    if (cleaned.changed > 0) {
      result = cleaned.messages
      applied.push(`dataCleaning: ${cleaned.changed} messages cleaned`)
    }
  }

  if (config.blacklistKeywords.length > 0) {
    const before = result.length
    result = applyBlacklistFilter(result, config.blacklistKeywords)
    applied.push(`blacklist: ${before} → ${result.length} (-${before - result.length})`)
  }

  if (config.denoise) {
    const before = result.length
    result = applyDenoise(result)
    applied.push(`denoise: ${before} → ${result.length} (-${before - result.length})`)
  }

  if (config.mergeConsecutive) {
    const before = result.length
    result = applyMergeConsecutive(result, config.mergeWindowSeconds ?? MERGE_WINDOW_DEFAULT)
    applied.push(`merge: ${before} → ${result.length} (-${before - result.length})`)
  }

  if (config.desensitize) {
    const enabledRules = (config.desensitizeRules || []).filter((r) => r.enabled)
    if (enabledRules.length > 0) {
      result = applyDesensitize(result, enabledRules)
      applied.push(`desensitize: ${enabledRules.length} rules applied`)
    }
  }

  aiLogger.info('Preprocess', `Pipeline: ${inputCount} → ${result.length} messages`, {
    strategies: applied,
  })

  return result
}

function hasAnyEnabled(config: PreprocessConfig): boolean {
  return (
    config.dataCleaning !== false ||
    config.mergeConsecutive ||
    config.blacklistKeywords.length > 0 ||
    config.denoise ||
    config.desensitize
  )
}

// ==================== 策略实现 ====================

/**
 * 数据清洗：将 XML 卡片消息（美团分享、音乐、公众号等）提取为简洁文本
 * 微信 XML 消息以 <?xml 或 <msg> 或 <msg>< 开头
 */
function applyDataCleaning<T extends PreprocessableMessage>(messages: T[]): { messages: T[]; changed: number } {
  let changed = 0
  const result = messages.map((msg) => {
    if (!msg.content) return msg
    const cleaned = cleanXmlContent(msg.content)
    if (cleaned === msg.content) return msg
    changed++
    return { ...msg, content: cleaned }
  })
  return { messages: result, changed }
}

const XML_START = /^<\?xml\s|^<msg[\s>]/

function cleanXmlContent(content: string): string {
  const trimmed = content.trim()
  if (!XML_START.test(trimmed)) return content

  const title = extractXmlTag(trimmed, 'title')
  const des = extractXmlTag(trimmed, 'des')

  if (title) {
    return des ? `[分享] ${title} - ${des}` : `[分享] ${title}`
  }
  return '[应用消息]'
}

function extractXmlTag(xml: string, tag: string): string | null {
  const openTag = `<${tag}>`
  const closeTag = `</${tag}>`
  const start = xml.indexOf(openTag)
  if (start === -1) return null
  const contentStart = start + openTag.length
  const end = xml.indexOf(closeTag, contentStart)
  if (end === -1) return null
  const value = xml.slice(contentStart, end).trim()
  return value.length > 0 ? value : null
}

/**
 * 黑名单过滤：消息内容包含任一关键词则整条移除
 */
function applyBlacklistFilter<T extends PreprocessableMessage>(messages: T[], keywords: string[]): T[] {
  if (keywords.length === 0) return messages
  const lowerKeywords = keywords.map((k) => k.toLowerCase())
  return messages.filter((msg) => {
    if (!msg.content) return true
    const lower = msg.content.toLowerCase()
    return !lowerKeywords.some((kw) => lower.includes(kw))
  })
}

/**
 * 智能去噪：过滤无意义消息
 * - 内容长度 < 2 的纯文本（如 "嗯"、"哦"）
 * - 纯表情消息
 * - 系统占位符（[图片]、[视频]、[语音] 等）
 * 回复保护：有 replyToMessageId 的消息不过滤
 */
function applyDenoise<T extends PreprocessableMessage>(messages: T[]): T[] {
  return messages.filter((msg) => {
    if (!msg.content) return false

    if (msg.replyToMessageId) return true

    const content = msg.content.trim()
    if (content.length === 0) return false

    if (content.length < 2) return false

    if (SYSTEM_PLACEHOLDERS.has(content)) return false

    if (isPureEmoji(content)) return false

    return true
  })
}

const SYSTEM_PLACEHOLDERS = new Set([
  '[图片]',
  '[视频]',
  '[语音]',
  '[文件]',
  '[动画表情]',
  '[表情]',
  '[链接]',
  '[位置]',
  '[名片]',
  '[红包]',
  '[转账]',
  '[音乐]',
  '[Image]',
  '[Video]',
  '[Voice]',
  '[File]',
  '[Sticker]',
  '[Link]',
])

function isPureEmoji(str: string): boolean {
  const stripped = str
    .replace(/\p{Emoji_Presentation}/gu, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\u200d/g, '')
    .replace(/\ufe0f/g, '')
    .replace(/\u20e3/g, '')
    .replace(/\s/g, '')
  return stripped.length === 0
}

/**
 * 合并连续发言：同一发送者在时间窗口内的连续消息合并为一条
 * 使用 senderPlatformId（如可用），否则 fallback 到 senderName
 */
function applyMergeConsecutive<T extends PreprocessableMessage>(messages: T[], windowSeconds: number): T[] {
  if (messages.length <= 1) return messages

  const merged: T[] = []
  let current: T | null = null

  for (const msg of messages) {
    if (!current) {
      current = { ...msg }
      continue
    }

    const sameSender = isSameSender(current, msg)
    const withinWindow = Math.abs(msg.timestamp - current.timestamp) <= windowSeconds

    if (sameSender && withinWindow) {
      current = {
        ...current,
        content: [current.content, msg.content].filter(Boolean).join('\n'),
      }
    } else {
      merged.push(current)
      current = { ...msg }
    }
  }

  if (current) merged.push(current)
  return merged
}

function isSameSender(a: PreprocessableMessage, b: PreprocessableMessage): boolean {
  if (a.senderPlatformId && b.senderPlatformId) {
    return a.senderPlatformId === b.senderPlatformId
  }
  return a.senderName === b.senderName
}

/**
 * 数据脱敏：按规则列表顺序依次替换敏感信息
 * 规则按列表优先级排序，先匹配的先替换
 * 自定义正则有超时保护（单条规则 50ms 上限）
 */
function applyDesensitize<T extends PreprocessableMessage>(messages: T[], rules: DesensitizeRule[]): T[] {
  const compiledRules = compileRules(rules)
  if (compiledRules.length === 0) return messages

  return messages.map((msg) => {
    if (!msg.content) return msg
    let content = msg.content
    for (const { regex, replacement } of compiledRules) {
      regex.lastIndex = 0
      content = content.replace(regex, replacement)
    }
    if (content === msg.content) return msg
    return { ...msg, content }
  })
}

const regexCache = new Map<string, RegExp | null>()

function compileRules(rules: DesensitizeRule[]): Array<{ regex: RegExp; replacement: string }> {
  const result: Array<{ regex: RegExp; replacement: string }> = []
  for (const rule of rules) {
    let regex = regexCache.get(rule.pattern)
    if (regex === undefined) {
      try {
        regex = new RegExp(rule.pattern, 'g')
        regexCache.set(rule.pattern, regex)
      } catch {
        aiLogger.warn('Preprocess', `Invalid regex in desensitize rule "${rule.id}": ${rule.pattern}`)
        regexCache.set(rule.pattern, null)
        continue
      }
    }
    if (regex) {
      result.push({ regex, replacement: rule.replacement })
    }
  }
  return result
}
