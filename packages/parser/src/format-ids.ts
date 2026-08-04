export const PARSER_FORMAT_IDS = {
  CHATLAB: 'chatlab',
  CHATLAB_JSONL: 'chatlab-jsonl',
  QQ_SHUAKAMI: 'qq-shuakami',
  QQ_SHUAKAMI_CHUNKED: 'qq-shuakami-chunked',
  WEFLOW: 'weflow',
  ECHOTRACE: 'echotrace',
  DISCORD_TYRRRZ: 'discord-tyrrrz',
  TELEGRAM_NATIVE: 'telegram-native',
  TELEGRAM_NATIVE_SINGLE: 'telegram-native-single',
  GOOGLE_CHAT_NATIVE: 'google-chat-native',
  INSTAGRAM_NATIVE: 'instagram-native',
  WHATSAPP_NATIVE: 'whatsapp-native',
  QQ_NATIVE: 'qq-native',
  LINE_NATIVE: 'line-native',
} as const

export type ParserFormatId = (typeof PARSER_FORMAT_IDS)[keyof typeof PARSER_FORMAT_IDS]

export const LEGACY_PARSER_FORMAT_ID_ALIASES = {
  'shuakami-qq-exporter': PARSER_FORMAT_IDS.QQ_SHUAKAMI,
  'shuakami-qq-exporter-chunked': PARSER_FORMAT_IDS.QQ_SHUAKAMI_CHUNKED,
  'ycccccccy-echotrace': PARSER_FORMAT_IDS.ECHOTRACE,
  'tyrrrz-discord-exporter': PARSER_FORMAT_IDS.DISCORD_TYRRRZ,
  'whatsapp-native-txt': PARSER_FORMAT_IDS.WHATSAPP_NATIVE,
  'qq-native-txt': PARSER_FORMAT_IDS.QQ_NATIVE,
  'line-native-txt': PARSER_FORMAT_IDS.LINE_NATIVE,
  'google-chat-takeout': PARSER_FORMAT_IDS.GOOGLE_CHAT_NATIVE,
} as const satisfies Record<string, ParserFormatId>

export function normalizeParserFormatId(formatId: string): string {
  return LEGACY_PARSER_FORMAT_ID_ALIASES[formatId as keyof typeof LEGACY_PARSER_FORMAT_ID_ALIASES] ?? formatId
}

export function isParserFormatId(formatId: string): formatId is ParserFormatId {
  return Object.values(PARSER_FORMAT_IDS).some((candidate) => candidate === formatId)
}
