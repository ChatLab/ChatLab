/**
 * Shared LLM simple streaming — used by both Electron and Server.
 *
 * Wraps pi-ai's streamSimple with message preprocessing,
 * event mapping, and error handling.
 */

import { streamSimple } from '@earendil-works/pi-ai'
import type { Model as PiModel, Api as PiApi, Message as PiMessage } from '@earendil-works/pi-ai'

export interface LlmStreamChunk {
  content: string
  isFinished: boolean
  finishReason?: 'stop' | 'length' | 'error'
  error?: string
  /** When present, this chunk carries thinking/reasoning content rather than final text. */
  thinking?: string
  /** Signals the end of a thinking block (thinking is empty string, thinkingDone is true). */
  thinkingDone?: boolean
}

export interface RunSimpleLlmStreamOptions {
  messages: Array<{ role: string; content: string }>
  apiKey: string
  piModel: PiModel<PiApi>
  temperature?: number
  maxTokens?: number
  onChunk: (chunk: LlmStreamChunk) => void
  abortSignal?: AbortSignal
}

function toPiMessages(messages: Array<{ role: string; content: string }>, timestamp: number): PiMessage[] {
  return messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
    timestamp,
  })) as unknown as PiMessage[]
}

/**
 * Run a simple LLM streaming call.
 * Separates system message, streams text deltas via onChunk callback.
 */
export async function runSimpleLlmStream(options: RunSimpleLlmStreamOptions): Promise<void> {
  const { messages, apiKey, piModel, temperature, maxTokens, onChunk, abortSignal } = options

  const systemMsg = messages.find((m) => m.role === 'system')
  const nonSystemMsgs = messages.filter((m) => m.role !== 'system')
  const now = Date.now()

  const eventStream = streamSimple(
    piModel,
    {
      systemPrompt: systemMsg?.content,
      messages: toPiMessages(nonSystemMsgs, now),
    },
    { apiKey, temperature, maxTokens, signal: abortSignal }
  )

  let hasTerminalChunk = false

  try {
    for await (const event of eventStream) {
      if (abortSignal?.aborted) {
        if (!hasTerminalChunk) {
          hasTerminalChunk = true
          onChunk({ content: '', isFinished: true, finishReason: 'stop' })
        }
        return
      }

      if (event.type === 'thinking_start') {
        onChunk({ content: '', isFinished: false, thinking: '' })
        continue
      }

      if (event.type === 'thinking_delta') {
        onChunk({ content: '', isFinished: false, thinking: event.delta })
        continue
      }

      if (event.type === 'thinking_end') {
        onChunk({ content: '', isFinished: false, thinking: '', thinkingDone: true })
        continue
      }

      if (event.type === 'text_delta') {
        onChunk({ content: event.delta, isFinished: false })
        continue
      }

      if (event.type === 'done') {
        hasTerminalChunk = true
        onChunk({ content: '', isFinished: true, finishReason: event.reason === 'length' ? 'length' : 'stop' })
        return
      }

      if (event.type === 'error') {
        hasTerminalChunk = true
        const errorMsg =
          event.error?.content
            ?.filter((c) => c.type === 'text')
            .map((c) => ('text' in c ? c.text : ''))
            .join('') || 'Unknown LLM error'
        onChunk({ content: '', isFinished: true, finishReason: 'error', error: errorMsg })
        return
      }
    }

    if (!hasTerminalChunk) {
      onChunk({ content: '', isFinished: true, finishReason: 'stop' })
    }
  } catch (error) {
    if (!hasTerminalChunk) {
      const msg = error instanceof Error ? error.message : String(error)
      onChunk({ content: '', isFinished: true, finishReason: 'error', error: msg })
    }
  }
}
