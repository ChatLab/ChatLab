import {
  PARSER_FORMAT_IDS,
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
  normalizeParserFormatId,
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
  | typeof PARSER_FORMAT_IDS.WHATSAPP_NATIVE
  | typeof PARSER_FORMAT_IDS.LINE_NATIVE
  | typeof PARSER_FORMAT_IDS.QQ_NATIVE
  | typeof PARSER_FORMAT_IDS.TELEGRAM_NATIVE
  | typeof PARSER_FORMAT_IDS.TELEGRAM_NATIVE_SINGLE
  | typeof PARSER_FORMAT_IDS.WEFLOW

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

const BROWSER_IMPORT_FORMAT_IDS = new Set<string>([
  PARSER_FORMAT_IDS.CHATLAB,
  PARSER_FORMAT_IDS.CHATLAB_JSONL,
  PARSER_FORMAT_IDS.WEFLOW,
  PARSER_FORMAT_IDS.WHATSAPP_NATIVE,
  PARSER_FORMAT_IDS.LINE_NATIVE,
  PARSER_FORMAT_IDS.QQ_NATIVE,
  PARSER_FORMAT_IDS.TELEGRAM_NATIVE,
  PARSER_FORMAT_IDS.TELEGRAM_NATIVE_SINGLE,
])

export function normalizeBrowserImportFormatId(formatId: string | undefined): BrowserImportFormatId | undefined {
  if (!formatId) return undefined
  const canonicalId = normalizeParserFormatId(formatId)
  return BROWSER_IMPORT_FORMAT_IDS.has(canonicalId) ? (canonicalId as BrowserImportFormatId) : undefined
}

export async function detectBrowserImportFormat(source: BrowserParseSource): Promise<BrowserImportFormatId | null> {
  if (source.name.toLowerCase().endsWith('.txt')) {
    const head = await source.slice(0, HEAD_BYTES).text()
    if (detectWhatsAppText(head, source.name)) return PARSER_FORMAT_IDS.WHATSAPP_NATIVE
    if (detectQqText(head, source.name)) return PARSER_FORMAT_IDS.QQ_NATIVE
    return detectLineText(head, source.name) ? PARSER_FORMAT_IDS.LINE_NATIVE : null
  }
  if (source.name.toLowerCase().endsWith('.json')) {
    const head = await source.slice(0, HEAD_BYTES).text()
    if (detectWeFlowJson(head, source.name)) return PARSER_FORMAT_IDS.WEFLOW
    if (detectTelegramMultiChatJson(head, source.name)) return PARSER_FORMAT_IDS.TELEGRAM_NATIVE
    if (detectTelegramSingleJson(head, source.name)) return PARSER_FORMAT_IDS.TELEGRAM_NATIVE_SINGLE
  }
  return detectChatLabFormat(source)
}

export async function scanBrowserMultiChatSource(
  source: BrowserParseSource,
  options: Pick<ParseBrowserSourceOptions, 'checkCancelled' | 'yieldEvery'> = {}
): Promise<TelegramChatInfo[]> {
  const formatId = await detectBrowserImportFormat(source)
  if (formatId !== PARSER_FORMAT_IDS.TELEGRAM_NATIVE) {
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
  const formatId = options.formatId
    ? normalizeBrowserImportFormatId(options.formatId)
    : await detectBrowserImportFormat(source)
  if (!formatId) {
    throw new WebRuntimeError(
      'UNSUPPORTED_IMPORT_FORMAT',
      'Unsupported file format; expected ChatLab JSON, ChatLab JSONL, WeFlow JSON, WhatsApp TXT, LINE TXT, QQ TXT, or Telegram JSON'
    )
  }

  if (formatId === PARSER_FORMAT_IDS.CHATLAB || formatId === PARSER_FORMAT_IDS.WEFLOW) {
    const wasmResult = await parseWithWasm(source, formatId, {
      checkCancelled: options.checkCancelled,
      onProgress: options.onProgress,
      onLog: options.onLog,
      loader: options.wasmLoader,
    })
    if (wasmResult) return wasmResult
  }

  if (formatId === PARSER_FORMAT_IDS.WHATSAPP_NATIVE) {
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

  if (formatId === PARSER_FORMAT_IDS.WEFLOW) {
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

  if (formatId === PARSER_FORMAT_IDS.LINE_NATIVE) {
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

  if (formatId === PARSER_FORMAT_IDS.QQ_NATIVE) {
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

  if (formatId === PARSER_FORMAT_IDS.TELEGRAM_NATIVE_SINGLE) {
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

  if (formatId === PARSER_FORMAT_IDS.TELEGRAM_NATIVE) {
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
