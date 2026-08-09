import { getRegisteredAdapter } from '../registry'
import type { ChatTopicsAdapter } from './types'

export function useChatTopicsService(): ChatTopicsAdapter {
  return getRegisteredAdapter<ChatTopicsAdapter>('chat-topics')
}
