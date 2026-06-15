/**
 * 文本处理工具（纯函数，平台无关）
 */

const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu
const EMOJI_VARIATION_SELECTOR_REGEX = /\u{FE0F}/gu
const PUNCTUATION_REGEX = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~，。！？、；：""''（）【】《》…—～·\s]/g
const URL_REGEX = /https?:\/\/[^\s]+/g
const MENTION_REGEX = /@[^\s@]+/g
const PURE_NUMBER_REGEX = /^\d+$/
const SYSTEM_PLACEHOLDER_REGEX =
  /\[(?:图片|视频|语音|文件|动画表情|表情|链接|位置|名片|红包|转账|音乐|Image|Video|Voice|File|Sticker|Link)\]/gi
const BRACKET_EMOJI_PLACEHOLDER_REGEX =
  /(?:\[|【)([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Letter}\p{Number}_-]{1,16})(?:\]|】)/gu
const CJK_TEXT_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

const BRACKET_EMOJI_MAP: Record<string, string> = {
  破涕为笑: '😂',
  微笑: '🙂',
  呲牙: '😁',
  大笑: '😄',
  笑哭: '😂',
  流泪: '😢',
  捂脸: '🤦',
  发呆: '😳',
  害羞: '😊',
  调皮: '😜',
  色: '😍',
  惊讶: '😮',
  撇嘴: '😒',
  难过: '😞',
  酷: '😎',
  抓狂: '😫',
  吐: '🤮',
  偷笑: '🤭',
  可爱: '😊',
  白眼: '🙄',
  傲慢: '😤',
  饥饿: '😋',
  困: '😴',
  惊恐: '😱',
  流汗: '😅',
  憨笑: '😄',
  悠闲: '😌',
  奋斗: '💪',
  咒骂: '😡',
  疑问: '❓',
  嘘: '🤫',
  晕: '😵',
  衰: '😞',
  敲打: '👊',
  再见: '👋',
  擦汗: '😅',
  抠鼻: '👃',
  鼓掌: '👏',
  坏笑: '😏',
  左哼哼: '😤',
  右哼哼: '😤',
  哈欠: '🥱',
  鄙视: '😒',
  委屈: '🥺',
  快哭了: '😢',
  阴险: '😏',
  亲亲: '😘',
  吓: '😱',
  可怜: '🥺',
  菜刀: '🔪',
  西瓜: '🍉',
  啤酒: '🍺',
  篮球: '🏀',
  乒乓: '🏓',
  咖啡: '☕',
  饭: '🍚',
  猪头: '🐷',
  玫瑰: '🌹',
  凋谢: '🥀',
  爱心: '❤️',
  心碎: '💔',
  蛋糕: '🎂',
  闪电: '⚡',
  炸弹: '💣',
  刀: '🔪',
  足球: '⚽',
  便便: '💩',
  月亮: '🌙',
  太阳: '☀️',
  礼物: '🎁',
  拥抱: '🤗',
  强: '👍',
  弱: '👎',
  握手: '🤝',
  胜利: '✌️',
  抱拳: '🙏',
  勾引: '☝️',
  拳头: '✊',
  差劲: '👎',
  爱你: '🤟',
  NO: '🙅',
  OK: '👌',
}

/**
 * 清理文本：移除 URL、@提及、表情、标点等
 */
export function cleanText(text: string): string {
  return text
    .replace(URL_REGEX, ' ')
    .replace(MENTION_REGEX, ' ')
    .replace(SYSTEM_PLACEHOLDER_REGEX, ' ')
    .replace(BRACKET_EMOJI_PLACEHOLDER_REGEX, (match, name: string) => {
      if (BRACKET_EMOJI_MAP[name]) return BRACKET_EMOJI_MAP[name]
      return CJK_TEXT_REGEX.test(name) ? ' ' : match
    })
    .replace(EMOJI_REGEX, ' ')
    .replace(EMOJI_VARIATION_SELECTOR_REGEX, ' ')
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
