/**
 * 文本处理工具（纯函数，平台无关）
 */

const EMOJI_REGEX =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu
const PUNCTUATION_REGEX = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~，。！？、；：""''（）【】《》…—～·\s]/g
const URL_REGEX = /https?:\/\/[^\s]+/g
const MENTION_REGEX = /@[^\s@]+/g
const PURE_NUMBER_REGEX = /^\d+$/
const SYSTEM_PLACEHOLDER_REGEX =
  /\[(?:图片|视频|语音|文件|动画表情|表情|链接|位置|名片|红包|转账|音乐|Image|Video|Voice|File|Sticker|Link)\]/gi

/**
 * 清理文本：移除 URL、@提及、表情、标点等
 */
export function cleanText(text: string): string {
  return text
    .replace(URL_REGEX, ' ')
    .replace(MENTION_REGEX, ' ')
    .replace(SYSTEM_PLACEHOLDER_REGEX, ' ')
    .replace(EMOJI_REGEX, ' ')
    .replace(PUNCTUATION_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
