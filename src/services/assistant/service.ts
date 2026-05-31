import { getRegisteredAdapter } from '../registry'
import type { AssistantServiceAdapter } from './types'

export function useAssistantService(): AssistantServiceAdapter {
  return getRegisteredAdapter<AssistantServiceAdapter>('assistant-crud')
}
