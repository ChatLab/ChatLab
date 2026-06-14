const SYSTEM_PLACEHOLDER_CONTENTS = new Set([
  '[图片]',
  '[视频]',
  '[语音]',
  '[文件]',
  '[动画表情]',
  '[表情]',
  '[链接]',
  '[位置]',
  '[地理位置]',
  '[名片]',
  '[红包]',
  '[转账]',
  '[音乐]',
  '[回复消息]',
  '[Image]',
  '[Photo]',
  '[Video]',
  '[Voice]',
  '[File]',
  '[Sticker]',
  '[Link]',
  '[Location]',
])

export function isSystemPlaceholderContent(content: string): boolean {
  return SYSTEM_PLACEHOLDER_CONTENTS.has(content.trim())
}
