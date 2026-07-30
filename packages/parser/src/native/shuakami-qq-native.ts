/** shuakami/qq-chat-exporter V4 adapter for the unified native-first wrapper. */

import { KNOWN_PLATFORMS, ChatType, type MessageType } from '@openchatlab/shared-types'
import type { NativeMember, NativeMessage } from '@openchatlab/parser-native'
import type { ParsedMember, ParsedMessage, ParsedMeta } from '../types'
import { createNativeFirstParser, type NativeFormatAdapter, type ParseGenerator } from './create-native-parser'

interface ShuakamiQqMetaJson {
  name: string
  chatType: string
  groupAvatar: string | null
  skippedMessages: number
}

export const shuakamiQqAdapter: NativeFormatAdapter = {
  formatId: 'shuakami-qq-exporter',
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

/** Wrap the pure TypeScript shuakami/qq-chat-exporter V4 parser with N-API acceleration. */
export function withShuakamiQqNative(fallback: ParseGenerator): ParseGenerator {
  return createNativeFirstParser(shuakamiQqAdapter, fallback)
}
