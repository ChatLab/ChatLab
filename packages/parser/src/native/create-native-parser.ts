/**
 * Unified Rust-accelerated parsing with transparent TS fallback.
 *
 * One wrapper serves every native-first format: it loads the native module,
 * constructs the shared Rust `NativeParser`, polls progress, pumps members
 * and message batches, and falls back to the pure-TS parser when the native
 * module is unavailable, disabled via CHATLAB_DISABLE_NATIVE_PERF=1, or the
 * Rust kernel fails (kernels fail before any data event is emitted, so a TS
 * restart is always safe).
 *
 * Per-format specifics live in a small `NativeFormatAdapter`: the Rust kernel
 * id, plus mappers from the unified native structs (and the kernel's meta
 * JSON) to ParseEvent payloads. Event order and payload shapes must stay
 * identical to the TS parser of the same format (verified by parity tests).
 */

import type { NativeMember, NativeMessage, NativeParser } from '@openchatlab/parser-native'
import type { ParseEvent, ParseOptions, ParsedMember, ParsedMessage, ParsedMeta } from '../types'
import { getFileSize, createProgress } from '../utils'
import { loadNativeParser } from './loader'

const PROGRESS_POLL_INTERVAL_MS = 200

export type ParseGenerator = (options: ParseOptions) => AsyncGenerator<ParseEvent, void, unknown>

export interface NativeFormatAdapter {
  /** Kernel id understood by the Rust NativeParser constructor. */
  formatId: string
  /** Human-readable format label used in import logs. */
  label: string
  /** Map the kernel's meta JSON (parsed) to the ParsedMeta event payload. */
  mapMeta: (metaJson: unknown) => ParsedMeta
  /** Map native members to the ParsedMember event payload. */
  mapMembers: (members: NativeMember[], metaJson: unknown) => ParsedMember[]
  /** Map one native message to the ParsedMessage event payload. */
  mapMessage: (message: NativeMessage, metaJson: unknown) => ParsedMessage
}

async function* pumpNativeParser(
  adapter: NativeFormatAdapter,
  options: ParseOptions,
  parser: NativeParser,
  fallback: ParseGenerator
): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options

  const totalBytes = getFileSize(filePath)
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)
  onLog?.(
    'info',
    `[NativeParser] Parsing ${adapter.label} with Rust kernel, size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`
  )

  const progressTimer = setInterval(() => {
    const progress = parser.progress()
    onProgress?.(
      createProgress(
        'parsing',
        progress.bytesRead,
        totalBytes,
        progress.messagesProcessed,
        `已处理 ${progress.messagesProcessed} 条消息...`
      )
    )
  }, PROGRESS_POLL_INTERVAL_MS)

  try {
    await parser.parse()
  } catch (error) {
    onLog?.(
      'warn',
      `[NativeParser] Rust parse failed, falling back to TS parser: ${error instanceof Error ? error.message : String(error)}`
    )
    // Only progress events have been emitted so far — safe to restart with TS.
    yield* fallback(options)
    return
  } finally {
    clearInterval(progressTimer)
  }

  const metaJson: unknown = JSON.parse(parser.metaJson())
  yield { type: 'meta', data: adapter.mapMeta(metaJson) }

  const members = adapter.mapMembers(parser.takeMembers(), metaJson)
  yield { type: 'members', data: members }

  let messagesProcessed = 0
  while (true) {
    const batch = parser.takeBatch(batchSize)
    if (!batch) break
    messagesProcessed += batch.length
    yield { type: 'messages', data: batch.map((message) => adapter.mapMessage(message, metaJson)) }
    // The consumer typically does synchronous DB writes per batch; yield a
    // macrotask so the event loop can flush pending I/O (e.g. SSE progress
    // events) instead of being starved until all batches are delivered.
    await new Promise((resolve) => setImmediate(resolve))
  }

  const doneProgress = createProgress('done', totalBytes, totalBytes, messagesProcessed, '')
  yield { type: 'progress', data: doneProgress }
  onProgress?.(doneProgress)
  onLog?.('info', `解析完成: ${messagesProcessed} 条消息, ${members.length} 个成员`)

  yield { type: 'done', data: { messageCount: messagesProcessed, memberCount: members.length } }
}

/** Wrap a TS parse generator with native acceleration for the given format. */
export function createNativeFirstParser(adapter: NativeFormatAdapter, fallback: ParseGenerator): ParseGenerator {
  return async function* (options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
    const native = loadNativeParser()
    if (!native) {
      yield* fallback(options)
      return
    }

    let parser: NativeParser
    try {
      parser = new native.NativeParser(
        adapter.formatId,
        options.filePath,
        options.formatOptions ? JSON.stringify(options.formatOptions) : undefined
      )
    } catch (error) {
      options.onLog?.(
        'warn',
        `[NativeParser] Failed to create Rust parser, falling back to TS parser: ${error instanceof Error ? error.message : String(error)}`
      )
      yield* fallback(options)
      return
    }

    yield* pumpNativeParser(adapter, options, parser, fallback)
  }
}
