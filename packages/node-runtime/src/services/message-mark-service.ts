import {
  getMessageMark as coreGetMessageMark,
  saveMessageMark as coreSaveMessageMark,
  type MessageMark,
  type MessageMarkInput,
} from '@openchatlab/core'
import type { SessionRuntimeAdapter } from './adapters'

export function getMessageMark(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  messageId: number
): MessageMark | null {
  return coreGetMessageMark(adapter.ensureReadonly(sessionId), messageId)
}

export function saveMessageMark(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  messageId: number,
  input: MessageMarkInput
): MessageMark | null {
  return coreSaveMessageMark(adapter.ensureWritable(sessionId), messageId, input)
}
