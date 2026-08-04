/** shuakami/qq-chat-exporter V4 adapter for the unified native-first wrapper. */

import { KNOWN_PLATFORMS, ChatType, type MessageType } from '@openchatlab/shared-types'
import type { NativeMember, NativeMessage } from '@openchatlab/parser-native'
import type { ParseEvent, ParseOptions, ParsedMember, ParsedMessage, ParsedMeta } from '../types'
import { getFileSize } from '../utils'
import { shuakamiQqPreprocessor } from '../formats/shuakami-qq-preprocessor'
import { createNativeFirstParser, type NativeFormatAdapter, type ParseGenerator } from './create-native-parser'

interface ShuakamiQqMetaJson {
  name: string
  chatType: string
  groupAvatar: string | null
  skippedMessages: number
}

export const shuakamiQqAdapter: NativeFormatAdapter = {
  kernelId: 'shuakami-qq-exporter',
  label: 'shuakami/qq-chat-exporter',

  mapMeta(metaJson: unknown): ParsedMeta {
    const meta = metaJson as ShuakamiQqMetaJson
    return {
      name: meta.name,
      platform: KNOWN_PLATFORMS.QQ,
      type: meta.chatType === 'private' ? ChatType.PRIVATE : ChatType.GROUP,
      groupAvatar: meta.groupAvatar ?? undefined,
    }
  },

  mapMembers(members: NativeMember[]): ParsedMember[] {
    return members.map((member) => ({
      platformId: member.platformId,
      accountName: member.accountName,
      groupNickname: member.groupNickname,
      avatar: member.avatar,
    }))
  },

  mapMessage(message: NativeMessage): ParsedMessage {
    return {
      platformMessageId: message.platformMessageId,
      senderPlatformId: message.senderPlatformId,
      senderAccountName: message.senderAccountName,
      senderGroupNickname: message.senderGroupNickname,
      timestamp: message.timestamp as number,
      type: message.messageType as MessageType,
      content: message.content ?? null,
      replyToMessageId: message.replyToMessageId,
    }
  },

  completionLogs(metaJson: unknown): string[] {
    const skipped = (metaJson as ShuakamiQqMetaJson).skippedMessages
    return skipped > 0
      ? [
          `[NativeParser] Skipped ${skipped} shuakami/qq-chat-exporter messages with a missing sender ID or invalid timestamp`,
        ]
      : []
  },
}

async function* fallbackAfterNativeFailure(
  fallback: ParseGenerator,
  options: ParseOptions
): AsyncGenerator<ParseEvent, void, unknown> {
  if (!shuakamiQqPreprocessor.needsPreprocess(options.filePath, getFileSize(options.filePath))) {
    yield* fallback(options)
    return
  }

  let slimFilePath: string | null = null
  try {
    options.onLog?.('info', '[NativeParser] Preprocessing large export before TypeScript fallback')
    slimFilePath = await shuakamiQqPreprocessor.preprocess(options.filePath, options.onProgress)
  } catch (error) {
    options.onLog?.(
      'warn',
      `[NativeParser] Fallback preprocessing failed; retrying the original export: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    yield* fallback(options)
    return
  }

  try {
    yield* fallback({ ...options, filePath: slimFilePath })
  } finally {
    if (slimFilePath) shuakamiQqPreprocessor.cleanup(slimFilePath)
  }
}

/** Wrap the pure TypeScript shuakami/qq-chat-exporter V4 parser with N-API acceleration. */
export function withShuakamiQqNative(fallback: ParseGenerator): ParseGenerator {
  return createNativeFirstParser(shuakamiQqAdapter, fallback, (options) =>
    fallbackAfterNativeFailure(fallback, options)
  )
}
