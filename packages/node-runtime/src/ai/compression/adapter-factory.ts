import {
  completeSimple,
  type Model as PiModel,
  type Api as PiApi,
  type TextContent as PiTextContent,
} from '@earendil-works/pi-ai'
import type { CompressionLlmAdapter } from './types'

export interface CreateCompressionLlmAdapterOptions {
  piModel: PiModel<PiApi>
  apiKey: string
  contextWindow?: number
  onCompressing?: () => void
  onError?: (error: unknown) => void
}

const DEFAULT_CONTEXT_WINDOW = 128000

/**
 * Create a CompressionLlmAdapter from a PiModel and API key.
 * Shared factory used by both Electron and Server.
 */
export function createCompressionLlmAdapter(options: CreateCompressionLlmAdapterOptions): CompressionLlmAdapter {
  const { piModel, apiKey, onCompressing, onError } = options
  const contextWindow = options.contextWindow ?? piModel.contextWindow ?? DEFAULT_CONTEXT_WINDOW

  return {
    contextWindow,
    compress: async (prompt: string, maxTokens: number) => {
      onCompressing?.()
      try {
        const result = await completeSimple(
          piModel,
          {
            systemPrompt: undefined,
            messages: [{ role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() }] as any,
          },
          { apiKey, maxTokens }
        )
        const text = result.content
          .filter((item): item is PiTextContent => item.type === 'text')
          .map((item) => item.text)
          .join('')
        return text || null
      } catch (error) {
        onError?.(error)
        return null
      }
    },
  }
}
