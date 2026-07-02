/**
 * Rust-accelerated ChatLab JSON parsing with transparent TS fallback.
 *
 * Event order and payload shapes are identical to the pure-TS parser in
 * formats/chatlab.ts for spec-compliant files (verified by parity tests).
 * The Rust kernel is strict about the format spec: off-spec files (wrong
 * field types, missing required fields) make parse() fail, and we fall back
 * to the TS parser which replicates all JS passthrough quirks. Fallback also
 * happens when the native module is unavailable or disabled via
 * CHATLAB_DISABLE_NATIVE_PERF=1.
 */

import type { ChatType, MessageType } from '@openchatlab/shared-types'
import type { ChatlabParser, NativeChatlabMember, NativeChatlabMessage } from '@openchatlab/parser-native'
import type { ParseEvent, ParseOptions, ParsedMember, ParsedMessage, ParsedMeta } from '../types'
import { getFileSize, createProgress } from '../utils'
import { loadNativeParser } from './loader'

const PROGRESS_POLL_INTERVAL_MS = 200

type ParseGenerator = (options: ParseOptions) => AsyncGenerator<ParseEvent, void, unknown>

function toParsedMessage(message: NativeChatlabMessage): ParsedMessage {
  return {
    senderPlatformId: message.senderPlatformId,
    senderAccountName: message.senderAccountName,
    senderGroupNickname: message.senderGroupNickname,
    timestamp: message.timestamp,
    type: message.messageType as MessageType,
    // The kernel rejects a missing content key, so undefined here always
    // means the source value was JSON null.
    content: message.content ?? null,
    platformMessageId: message.platformMessageId,
    replyToMessageId: message.replyToMessageId,
  }
}

function toParsedMember(member: NativeChatlabMember, fromHead: boolean): ParsedMember {
  if (!fromHead) {
    // Members collected from messages carry only these three keys in the TS
    // parser; keep the object shape identical.
    return {
      platformId: member.platformId,
      accountName: member.accountName,
      groupNickname: member.groupNickname,
    }
  }
  return {
    platformId: member.platformId,
    accountName: member.accountName,
    groupNickname: member.groupNickname,
    avatar: member.avatar,
    // Role objects pass through with their original key set ({id} or {id, name}).
    roles: member.roles?.map((role) => (role.name !== undefined ? { id: role.id, name: role.name } : { id: role.id })),
  }
}

async function* parseChatLabNative(
  options: ParseOptions,
  parser: ChatlabParser,
  fallback: ParseGenerator
): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options

  const totalBytes = getFileSize(filePath)
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)
  onLog?.(
    'info',
    `[NativeParser] Parsing ChatLab JSON with Rust kernel, size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`
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
    platform: nativeMeta.platform,
    type: nativeMeta.chatType as ChatType,
    groupId: nativeMeta.groupId,
    groupAvatar: nativeMeta.groupAvatar,
  }
  yield { type: 'meta', data: meta }

  const members = parser.takeMembers().map((member) => toParsedMember(member, nativeMeta.membersFromHead))
  yield { type: 'members', data: members }

  let messagesProcessed = 0
  while (true) {
    const batch = parser.takeBatch(batchSize)
    if (!batch) break
    messagesProcessed += batch.length
    yield { type: 'messages', data: batch.map(toParsedMessage) }
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

/** Wrap the TS ChatLab parse generator with native acceleration. */
export function withNativeChatlab(fallback: ParseGenerator): ParseGenerator {
  return async function* (options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
    const native = loadNativeParser()
    if (!native) {
      yield* fallback(options)
      return
    }

    let parser: ChatlabParser
    try {
      parser = new native.ChatlabParser(options.filePath)
    } catch (error) {
      options.onLog?.(
        'warn',
        `[NativeParser] Failed to create Rust parser, falling back to TS parser: ${error instanceof Error ? error.message : String(error)}`
      )
      yield* fallback(options)
      return
    }

    yield* parseChatLabNative(options, parser, fallback)
  }
}
