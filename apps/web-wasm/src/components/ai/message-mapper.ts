import type { RuntimeContentBlock, RuntimeMessage } from '@openchatlab/ai-runtime'
import type { ChatEvidencePayload } from '@openchatlab/core'
import type { ChatMessage, ContentBlock } from '@/stores/aiChat'

export function toWebAIContentBlocks(blocks: RuntimeContentBlock[] | undefined): ContentBlock[] {
  return (blocks ?? []).flatMap((block): ContentBlock[] => {
    if (block.type === 'text') return [{ type: 'text', text: block.text }]
    if (block.type === 'reasoning') return [{ type: 'think', tag: 'reasoning', text: block.text }]
    if (block.type === 'tool') {
      return [
        {
          type: 'tool',
          tool: {
            name: block.name,
            displayName: block.name,
            status: block.result ? (block.isError ? 'error' : 'done') : 'running',
            params: isRecord(block.input) ? block.input : undefined,
            toolCallId: block.callId,
            result: block.result?.content,
            displayResult: block.result?.content,
            isError: block.isError,
          },
        },
      ]
    }
    if (block.type === 'evidence' && isRecord(block.payload)) {
      return [{ type: 'evidence', evidence: block.payload as unknown as ChatEvidencePayload }]
    }
    return []
  })
}

export function toWebAIChatMessage(message: RuntimeMessage, isStreaming = false): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.createdAt,
    contentBlocks: toWebAIContentBlocks(message.blocks),
    isStreaming,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
