/**
 * 文本处理工具（纯函数，平台无关）
 */

import { KNOWN_BRACKET_EMOJI_NAMES, WECHAT_BRACKET_EMOJI_MAP } from './bracket-emoji'

const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu
const EMOJI_VARIATION_SELECTOR_REGEX = /\u{FE0F}/gu
const PUNCTUATION_REGEX = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~，。！？、；：""''（）【】《》…—～·\s]/g
const URL_REGEX = /https?:\/\/[^\s]+/g
const MENTION_REGEX = /@[^\s@]+/g
const PURE_NUMBER_REGEX = /^\d+$/
const MEDIA_PLACEHOLDER_NAME_PATTERN =
  '(?:图片|视频|语音|文件|动画表情|表情|链接|位置|地理位置|名片|红包|转账|音乐|Image|Photo|Video|Voice|Audio|File|Sticker|Link|Location)'
const MEDIA_PLACEHOLDER_DURATION_PATTERN = '(?:\\s+\\d+(?:\\.\\d+)?\\s*(?:秒|s))?'
const SYSTEM_PLACEHOLDER_REGEX = new RegExp(
  `\\[${MEDIA_PLACEHOLDER_NAME_PATTERN}${MEDIA_PLACEHOLDER_DURATION_PATTERN}\\]`,
  'gi'
)
const MEDIA_PLACEHOLDER_ONLY_REGEX = new RegExp(
  `^\\[${MEDIA_PLACEHOLDER_NAME_PATTERN}${MEDIA_PLACEHOLDER_DURATION_PATTERN}\\]$`,
  'i'
)
const VOICE_TRANSCRIPTION_PREFIX_REGEX = new RegExp(
  `^\\s*\\[(?:语音|Voice|Audio)${MEDIA_PLACEHOLDER_DURATION_PATTERN}\\]\\s*`,
  'i'
)
const SYSTEM_MESSAGE_PREFIX_REGEX =
  /^\s*(?:\[(?:系统(?:消息)?|分享内容|system(?:\s+message)?)\]|【(?:系统(?:消息)?|分享内容|system(?:\s+message)?)】)\s*/iu
const BRACKET_EMOJI_PLACEHOLDER_REGEX =
  /(?:\[|【)([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Letter}\p{Number}_-]{1,16})(?:\]|】)/gu
const CJK_TEXT_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

/**
 * 清理文本：移除 URL、@提及、表情、标点等
 */
export function cleanText(text: string): string {
  return text
    .replace(URL_REGEX, ' ')
    .replace(MENTION_REGEX, ' ')
    .replace(SYSTEM_PLACEHOLDER_REGEX, ' ')
    .replace(BRACKET_EMOJI_PLACEHOLDER_REGEX, (match, name: string) => {
      if (WECHAT_BRACKET_EMOJI_MAP[name]) return WECHAT_BRACKET_EMOJI_MAP[name]
      if (KNOWN_BRACKET_EMOJI_NAMES.has(name)) return ' '
      return CJK_TEXT_REGEX.test(name) ? ' ' : match
    })
    .replace(EMOJI_REGEX, ' ')
    .replace(EMOJI_VARIATION_SELECTOR_REGEX, ' ')
    .replace(PUNCTUATION_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Remove media placeholders, including duration-bearing labels such as `[语音 3秒]`. */
export function stripMediaPlaceholders(text: string): string {
  return text.replace(SYSTEM_PLACEHOLDER_REGEX, ' ')
}

/** Return the transcribed text after a leading voice-message label. */
export function stripVoiceTranscriptionPrefix(text: string): string {
  return text.replace(VOICE_TRANSCRIPTION_PREFIX_REGEX, '').trim()
}

/** Identify an explicit system/share marker without classifying bracketed emoji labels as system text. */
export function isSystemMessageContent(text: string): boolean {
  return SYSTEM_MESSAGE_PREFIX_REGEX.test(text)
}

/** Whether the complete value is a media placeholder rather than message text. */
export function isMediaPlaceholderContent(text: string): boolean {
  return MEDIA_PLACEHOLDER_ONLY_REGEX.test(text.trim())
}

/**
 * 判断是否为有效词语
 */
export function isValidWord(
  word: string,
  locale: string,
  minLength: number,
  enableStopwords: boolean,
  isStopwordFn: (word: string, locale: string) => boolean
): boolean {
  if (!word || word.trim().length === 0) return false
  if (PURE_NUMBER_REGEX.test(word)) return false
  if (word.length < minLength) return false
  if (enableStopwords && isStopwordFn(word, locale)) return false
  return true
}
