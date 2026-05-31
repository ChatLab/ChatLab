import { getRegisteredAdapter } from '../registry'
import type { LLMServiceAdapter } from './types'

export function useLLMService(): LLMServiceAdapter {
  return getRegisteredAdapter<LLMServiceAdapter>('llm')
}
