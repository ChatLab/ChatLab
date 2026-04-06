import type { ChatMessage } from '@/stores/aiChat'

export interface QAPair {
  user: ChatMessage | null
  assistant: ChatMessage | null
  id: string
}

/** 将消息列表分组为 QA 对（用户问题 + AI 回复） */
export function groupMessagesToQAPairs(messages: ChatMessage[]): QAPair[] {
  const pairs: QAPair[] = []
  let currentUser: ChatMessage | null = null

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (currentUser) {
        pairs.push({ user: currentUser, assistant: null, id: currentUser.id })
      }
      currentUser = msg
    } else if (msg.role === 'assistant') {
      pairs.push({ user: currentUser, assistant: msg, id: currentUser?.id || msg.id })
      currentUser = null
    }
  }

  if (currentUser) {
    pairs.push({ user: currentUser, assistant: null, id: currentUser.id })
  }

  return pairs
}
