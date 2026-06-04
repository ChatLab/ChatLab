/**
 * Filters imported chat placeholders out of catchphrase-style analytics.
 */

export const NON_HUMAN_CATCHPHRASE_PLACEHOLDERS = [
  '表情包',
  '动画表情',
  '表情',
  '图片',
  '图像',
  '照片',
  '相片',
  '语音',
  '音频',
  '视频',
  '文件',
  '链接',
  '位置',
  '红包',
  '转账',
  '分享',
  '名片',
  '聊天记录',
  '貼圖',
  '貼紙',
  '圖片',
  '語音',
  '音訊',
  '影片',
  '檔案',
  '連結',
  '位置資訊',
  '紅包',
  '轉帳',
  '分享',
  'スタンプ',
  '絵文字',
  '画像',
  '写真',
  '音声',
  '動画',
  'ファイル',
  'リンク',
  '場所',
  'sticker',
  'emoji',
  'emoticon',
  'image',
  'photo',
  'picture',
  'voice',
  'audio',
  'video',
  'file',
  'link',
  'location',
  'red packet',
  'redpacket',
  'transfer',
  'share',
  'shared',
] as const

const PLACEHOLDER_LABELS = new Set<string>(NON_HUMAN_CATCHPHRASE_PLACEHOLDERS.map((label) => label.toLowerCase()))

const RE_BRACKETED_CONTENT = /^(?:\[|【|\(|（)(.+)(?:\]|】|\)|）)$/
const RE_SYSTEM_EVENT_CONTENT = [
  /撤回了?一条消息/,
  /撤回了一則訊息/,
  /撤回了一条信息/,
  /消息已撤回/,
  /已撤回/,
  /删除了?一条消息/,
  /刪除了一則訊息/,
  /recalled (a |one |this )?message/i,
  /message (was )?(recalled|deleted)/i,
  /deleted (a |one |this )?message/i,
]

function normalizeContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim()
}

function isKnownPlaceholderLabel(label: string): boolean {
  const normalized = normalizeContent(label).toLowerCase()
  if (!normalized) return false
  if (PLACEHOLDER_LABELS.has(normalized)) return true

  const prefix = normalized.split(/[:：]/, 1)[0]?.trim()
  return !!prefix && PLACEHOLDER_LABELS.has(prefix)
}

export function isHumanCatchphraseContent(content: string): boolean {
  const normalized = normalizeContent(content)
  if (normalized.length < 2) return false

  const bracketMatch = normalized.match(RE_BRACKETED_CONTENT)
  if (bracketMatch && isKnownPlaceholderLabel(bracketMatch[1])) {
    return false
  }

  return !RE_SYSTEM_EVENT_CONTENT.some((pattern) => pattern.test(normalized))
}
