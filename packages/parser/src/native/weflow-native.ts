/**
 * Rust-accelerated WeFlow parsing with transparent TS fallback.
 *
 * Event order and payload shapes are identical to the pure-TS parser in
 * formats/weflow.ts (verified by parity tests): progress → meta → members →
 * message batches → done. Fallback happens when the native module is
 * unavailable, disabled via CHATLAB_DISABLE_NATIVE_PERF=1, or fails before
 * any data event has been emitted.
 */

import { KNOWN_PLATFORMS, ChatType, type MessageType } from '@openchatlab/shared-types'
import type { NativeParsedMessage, WeflowParser } from '@openchatlab/parser-native'
import type { ParseEvent, ParseOptions, ParsedMessage, ParsedMeta } from '../types'
import { getFileSize, createProgress } from '../utils'
import { loadNativeParser } from './loader'

const PROGRESS_POLL_INTERVAL_MS = 200

type ParseGenerator = (options: ParseOptions) => AsyncGenerator<ParseEvent, void, unknown>

function toParsedMessage(message: NativeParsedMessage): ParsedMessage {
  return {
    platformMessageId: message.platformMessageId,
    senderPlatformId: message.senderPlatformId,
    senderAccountName: message.senderAccountName,
    // WeFlow has no separate group nickname field (same as the TS parser).
    senderGroupNickname: undefined,
    // The TS parser passes createTime through as-is, including null.
    timestamp: (message.timestamp ?? null) as unknown as number,
    type: message.messageType as MessageType,
    content: message.content ?? null,
  }
}

async function* parseWeFlowNative(
  options: ParseOptions,
  parser: WeflowParser,
  fallback: ParseGenerator
): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options

  const totalBytes = getFileSize(filePath)
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)
  onLog?.(
    'info',
    `[NativeParser] Parsing WeFlow export with Rust kernel, size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`
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

  const nativeMeta = parser.getMeta()
  const meta: ParsedMeta = {
    name: nativeMeta.name,
    platform: KNOWN_PLATFORMS.WECHAT,
    type: nativeMeta.chatType === 'private' ? ChatType.PRIVATE : ChatType.GROUP,
    groupId: nativeMeta.groupId,
    groupAvatar: nativeMeta.groupAvatar,
    ownerId: nativeMeta.ownerId,
  }
  yield { type: 'meta', data: meta }

  const members = parser.takeMembers().map((member) => ({
    platformId: member.platformId,
    accountName: member.accountName,
    avatar: member.avatar,
  }))
  yield { type: 'members', data: members }

  let messagesProcessed = 0
  while (true) {
    const batch = parser.takeBatch(batchSize)
    if (!batch) break
    messagesProcessed += batch.length
    yield { type: 'messages', data: batch.map(toParsedMessage) }
  }

  const doneProgress = createProgress('done', totalBytes, totalBytes, messagesProcessed, '')
  yield { type: 'progress', data: doneProgress }
  onProgress?.(doneProgress)
  onLog?.('info', `解析完成: ${messagesProcessed} 条消息, ${members.length} 个成员`)

  yield { type: 'done', data: { messageCount: messagesProcessed, memberCount: members.length } }
}

/**
 * Wrap a TS parse generator with native acceleration. Used by the WeFlow and
 * ycccccccy-echotrace format modules (they share the same data structure).
 */
export function withNativeWeflow(fallback: ParseGenerator): ParseGenerator {
  return async function* (options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
    const native = loadNativeParser()
    if (!native) {
      yield* fallback(options)
      return
    }

    let parser: WeflowParser
    try {
      parser = new native.WeflowParser(options.filePath)
    } catch (error) {
      options.onLog?.(
        'warn',
        `[NativeParser] Failed to create Rust parser, falling back to TS parser: ${error instanceof Error ? error.message : String(error)}`
      )
      yield* fallback(options)
      return
    }

    yield* parseWeFlowNative(options, parser, fallback)
  }
}
