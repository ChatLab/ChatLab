/**
 * ChatLab JSON adapter for the unified native-first wrapper.
 *
 * Payload shapes are identical to the pure-TS parser in formats/chatlab.ts
 * for spec-compliant files (verified by parity tests). The Rust kernel is
 * strict about the format spec: off-spec files (wrong field types, missing
 * required fields) make parse() fail, and the wrapper falls back to the TS
 * parser which replicates all JS passthrough quirks.
 */

import type { ChatType, MessageType } from '@openchatlab/shared-types'
import type { NativeMember, NativeMessage } from '@openchatlab/parser-native'
import type { ParsedMember, ParsedMessage, ParsedMeta } from '../types'
import { createNativeFirstParser, type NativeFormatAdapter, type ParseGenerator } from './create-native-parser'

/** Shape of metaJson() from the Rust chatlab kernel. */
interface ChatlabMetaJson {
  name: string
  chatType: string
  platform: string
  groupId: string | null
  groupAvatar: string | null
  ownerId: string | null
  /**
   * true when members came from the top-level `members` array;
   * false when collected from messages (TS emits different object shapes).
   */
  membersFromHead: boolean
}

function toParsedMember(member: NativeMember, fromHead: boolean): ParsedMember {
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
    aliases: member.aliases,
    avatar: member.avatar,
    // Role objects pass through with their original key set ({id} or {id, name}).
    roles: member.roles?.map((role) => (role.name !== undefined ? { id: role.id, name: role.name } : { id: role.id })),
  }
}

const chatlabAdapter: NativeFormatAdapter = {
  formatId: 'chatlab',
  label: 'ChatLab JSON',

  mapMeta(metaJson: unknown): ParsedMeta {
    const meta = metaJson as ChatlabMetaJson
    return {
      name: meta.name,
      platform: meta.platform,
      type: meta.chatType as ChatType,
      groupId: meta.groupId ?? undefined,
      groupAvatar: meta.groupAvatar ?? undefined,
      ownerId: meta.ownerId ?? undefined,
    }
  },

  mapMembers(members: NativeMember[], metaJson: unknown): ParsedMember[] {
    const fromHead = (metaJson as ChatlabMetaJson).membersFromHead
    return members.map((member) => toParsedMember(member, fromHead))
  },

  mapMessage(message: NativeMessage): ParsedMessage {
    return {
      senderPlatformId: message.senderPlatformId,
      senderAccountName: message.senderAccountName,
      senderGroupNickname: message.senderGroupNickname,
      // The kernel rejects non-number timestamps, so this is always set.
      timestamp: message.timestamp as number,
      type: message.messageType as MessageType,
      // The kernel rejects a missing content key, so undefined here always
      // means the source value was JSON null.
      content: message.content ?? null,
      platformMessageId: message.platformMessageId,
      replyToMessageId: message.replyToMessageId,
    }
  },
}

/** Wrap the TS ChatLab parse generator with native acceleration. */
export function withNativeChatlab(fallback: ParseGenerator): ParseGenerator {
  return createNativeFirstParser(chatlabAdapter, fallback)
}
