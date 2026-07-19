import {
  detectLineText,
  detectQqText,
  detectTelegramMultiChatJson,
  detectTelegramSingleJson,
  detectWhatsAppText,
  detectWeFlowJson,
  parseLineText,
  parseQqText,
  parseTelegramMultiChatJson,
  parseTelegramSingleJson,
  parseWhatsAppText,
  parseWeFlowJson,
  scanTelegramChatsJson,
  type TelegramChatInfo,
} from '@openchatlab/parser/browser'

import { WebRuntimeError } from '../runtime-error'
import {
  detectChatLabFormat,
  parseChatLabSource,
  type BrowserChatParseProgress,
  type BrowserChatParseResult,
  type BrowserParseSource,
  type ChatLabBrowserFormatId,
} from './chatlab-parser'
import { parseWithWasm, type BrowserImportLogEvent, type BrowserWasmParserLoader } from './wasm-parser'

export type BrowserImportFormatId =
  | ChatLabBrowserFormatId
  | 'whatsapp-native-txt'
  | 'line-native-txt'
  | 'qq-native-txt'
  | 'telegram-native'
  | 'telegram-native-single'
  | 'weflow'

export interface ParseBrowserSourceOptions {
  formatId?: BrowserImportFormatId
  chatIndex?: number
  checkCancelled?: () => void
  onProgress?: (progress: BrowserChatParseProgress) => void
  yieldEvery?: number
  wasmLoader?: BrowserWasmParserLoader
  onLog?: (event: BrowserImportLogEvent) => void
}

export interface BrowserImportParseResult extends Omit<BrowserChatParseResult, 'formatId'> {
  formatId: BrowserImportFormatId
}

const HEAD_BYTES = 64 * 1024

export async function detectBrowserImportFormat(source: BrowserParseSource): Promise<BrowserImportFormatId | null> {
  if (source.name.toLowerCase().endsWith('.txt')) {
    const head = await source.slice(0, HEAD_BYTES).text()
    if (detectWhatsAppText(head, source.name)) return 'whatsapp-native-txt'
    if (detectQqText(head, source.name)) return 'qq-native-txt'
    return detectLineText(head, source.name) ? 'line-native-txt' : null
  }
  if (source.name.toLowerCase().endsWith('.json')) {
    const head = await source.slice(0, HEAD_BYTES).text()
    if (detectWeFlowJson(head, source.name)) return 'weflow'
    if (detectTelegramMultiChatJson(head, source.name)) return 'telegram-native'
    if (detectTelegramSingleJson(head, source.name)) return 'telegram-native-single'
  }
  return detectChatLabFormat(source)
}

export async function scanBrowserMultiChatSource(
  source: BrowserParseSource,
  options: Pick<ParseBrowserSourceOptions, 'checkCancelled' | 'yieldEvery'> = {}
): Promise<TelegramChatInfo[]> {
  const formatId = await detectBrowserImportFormat(source)
  if (formatId !== 'telegram-native') {
    throw new WebRuntimeError('NOT_MULTI_CHAT_FORMAT', 'The selected file is not a supported multi-chat export')
  }
  options.checkCancelled?.()
  const content = await source.text()
  options.checkCancelled?.()
  return scanTelegramChatsJson(content, options)
}

export async function parseBrowserImportSource(
  source: BrowserParseSource,
  options: ParseBrowserSourceOptions = {}
): Promise<BrowserImportParseResult> {
  const formatId = options.formatId ?? (await detectBrowserImportFormat(source))
  if (!formatId) {
    throw new WebRuntimeError(
      'UNSUPPORTED_IMPORT_FORMAT',
      'Unsupported file format; expected ChatLab JSON, ChatLab JSONL, WeFlow JSON, WhatsApp TXT, LINE TXT, QQ TXT, or Telegram JSON'
    )
  }

  if (formatId === 'chatlab' || formatId === 'weflow') {
    const wasmResult = await parseWithWasm(source, formatId, {
      checkCancelled: options.checkCancelled,
      onProgress: options.onProgress,
      onLog: options.onLog,
      loader: options.wasmLoader,
    })
    if (wasmResult) return wasmResult
  }

  if (formatId === 'whatsapp-native-txt') {
    options.checkCancelled?.()
    const content = await source.text()
    options.checkCancelled?.()
    const parsed = await parseWhatsAppText(content, source.name, {
      checkCancelled: options.checkCancelled,
      yieldEvery: options.yieldEvery,
      onProgress: (progress) => options.onProgress?.({ stage: 'parsing', ...progress }),
    })
    return {
      formatId,
      meta: parsed.meta,
      members: parsed.members,
      messages: parsed.messages,
    }
  }

  if (formatId === 'weflow') {
    options.checkCancelled?.()
    const content = await source.text()
    options.checkCancelled?.()
    const parsed = await parseWeFlowJson(content, source.name, {
      checkCancelled: options.checkCancelled,
      yieldEvery: options.yieldEvery,
      onProgress: (progress) => options.onProgress?.({ stage: 'parsing', ...progress }),
    })
    return {
      formatId,
      meta: parsed.meta,
      members: parsed.members,
      messages: parsed.messages,
    }
  }

  if (formatId === 'line-native-txt') {
    options.checkCancelled?.()
    const content = await source.text()
    options.checkCancelled?.()
    const parsed = await parseLineText(content, source.name, {
      checkCancelled: options.checkCancelled,
      yieldEvery: options.yieldEvery,
      onProgress: (progress) => options.onProgress?.({ stage: 'parsing', ...progress }),
    })
    return {
      formatId,
      meta: parsed.meta,
      members: parsed.members,
      messages: parsed.messages,
    }
  }

  if (formatId === 'qq-native-txt') {
    options.checkCancelled?.()
    const content = await source.text()
    options.checkCancelled?.()
    const parsed = await parseQqText(content, source.name, {
      checkCancelled: options.checkCancelled,
      yieldEvery: options.yieldEvery,
      onProgress: (progress) => options.onProgress?.({ stage: 'parsing', ...progress }),
    })
    return {
      formatId,
      meta: parsed.meta,
      members: parsed.members,
      messages: parsed.messages,
    }
  }

  if (formatId === 'telegram-native-single') {
    options.checkCancelled?.()
    const content = await source.text()
    options.checkCancelled?.()
    const parsed = await parseTelegramSingleJson(content, {
      checkCancelled: options.checkCancelled,
      yieldEvery: options.yieldEvery,
      onProgress: (progress) => options.onProgress?.({ stage: 'parsing', ...progress }),
    })
    return {
      formatId,
      meta: parsed.meta,
      members: parsed.members,
      messages: parsed.messages,
    }
  }

  if (formatId === 'telegram-native') {
    if (options.chatIndex === undefined) {
      throw new WebRuntimeError('MULTI_CHAT_SELECTION_REQUIRED', 'A Telegram chat index is required for import')
    }
    options.checkCancelled?.()
    const content = await source.text()
    options.checkCancelled?.()
    const parsed = await parseTelegramMultiChatJson(content, options.chatIndex, {
      checkCancelled: options.checkCancelled,
      yieldEvery: options.yieldEvery,
      onProgress: (progress) => options.onProgress?.({ stage: 'parsing', ...progress }),
    })
    return {
      formatId,
      meta: parsed.meta,
      members: parsed.members,
      messages: parsed.messages,
    }
  }

  return parseChatLabSource(source, {
    formatId,
    checkCancelled: options.checkCancelled,
    onProgress: options.onProgress,
    yieldEvery: options.yieldEvery,
  })
}

export type { BrowserParseSource } from './chatlab-parser'
export type { BrowserImportLogEvent, BrowserWasmParserLoader } from './wasm-parser'
