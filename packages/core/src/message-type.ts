/**
 * Message type number → semantic string mapping.
 *
 * Internal numeric enums (shared-types MessageType) are implementation details;
 * external contracts (CLI JSON output, agent-facing text) use semantic strings.
 */

import { MessageType } from '@openchatlab/shared-types'

const TYPE_STRING_MAP: Record<number, string> = {
  [MessageType.TEXT]: 'text',
  [MessageType.IMAGE]: 'image',
  [MessageType.VOICE]: 'voice',
  [MessageType.VIDEO]: 'video',
  [MessageType.FILE]: 'file',
  [MessageType.EMOJI]: 'emoji',
  [MessageType.LINK]: 'link',
  [MessageType.LOCATION]: 'location',
  [MessageType.RED_PACKET]: 'red_packet',
  [MessageType.TRANSFER]: 'transfer',
  [MessageType.POKE]: 'poke',
  [MessageType.CALL]: 'call',
  [MessageType.SHARE]: 'share',
  [MessageType.REPLY]: 'reply',
  [MessageType.FORWARD]: 'forward',
  [MessageType.CONTACT]: 'contact',
  [MessageType.SYSTEM]: 'system',
  [MessageType.RECALL]: 'recall',
  [MessageType.OTHER]: 'other',
}

export function messageTypeToString(type: number): string {
  return TYPE_STRING_MAP[type] ?? 'other'
}
