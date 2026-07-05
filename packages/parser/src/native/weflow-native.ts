/**
 * WeFlow adapter for the unified native-first wrapper.
 *
 * Payload shapes are identical to the pure-TS parser in formats/weflow.ts
 * (verified by parity tests). Shared by the ycccccccy-echotrace format module
 * (same data structure, same Rust kernel).
 */

import { KNOWN_PLATFORMS, ChatType, type MessageType } from '@openchatlab/shared-types'
import type { NativeMember, NativeMessage } from '@openchatlab/parser-native'
import type { ParsedMember, ParsedMessage, ParsedMeta } from '../types'
import { createNativeFirstParser, type NativeFormatAdapter, type ParseGenerator } from './create-native-parser'

/** Shape of metaJson() from the Rust weflow kernel. */
interface WeflowMetaJson {
  name: string
  chatType: string
  groupId: string | null
  groupAvatar: string | null
  ownerId: string | null
}

const weflowAdapter: NativeFormatAdapter = {
  formatId: 'weflow',
  label: 'WeFlow export',

  mapMeta(metaJson: unknown): ParsedMeta {
    const meta = metaJson as WeflowMetaJson
    return {
      name: meta.name,
      platform: KNOWN_PLATFORMS.WECHAT,
      type: meta.chatType === 'private' ? ChatType.PRIVATE : ChatType.GROUP,
      groupId: meta.groupId ?? undefined,
      groupAvatar: meta.groupAvatar ?? undefined,
      ownerId: meta.ownerId ?? undefined,
    }
  },

  mapMembers(members: NativeMember[]): ParsedMember[] {
    return members.map((member) => ({
      platformId: member.platformId,
      accountName: member.accountName,
      avatar: member.avatar,
    }))
  },

  mapMessage(message: NativeMessage): ParsedMessage {
    return {
      // The kernel always emits an id string (String(localId), JS semantics).
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
  },
}

/**
 * Wrap a TS parse generator with native acceleration. Used by the WeFlow and
 * ycccccccy-echotrace format modules (they share the same data structure).
 */
export function withNativeWeflow(fallback: ParseGenerator): ParseGenerator {
  return createNativeFirstParser(weflowAdapter, fallback)
}
