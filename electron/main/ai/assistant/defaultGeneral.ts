/**
 * 根据 locale 选择默认通用助手。
 * 默认助手的选择应发生在知道用户语言的上层，而不是存储层。
 */
export function getDefaultGeneralAssistantId(locale?: string): 'general_cn' | 'general_en' | 'general_ja' {
  if (locale?.startsWith('en')) return 'general_en'
  if (locale?.startsWith('ja')) return 'general_ja'
  return 'general_cn'
}
