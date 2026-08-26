import type {
  AIMemoryEntry,
  AIMemoryManagementEntry,
  AIMemoryScope,
  AIMemorySourceStatus,
  LinkAIMemorySourcesInput,
  LinkAIMemorySourcesResult,
} from '@openchatlab/shared-types'
import type { AIChatManager, AIMessage } from './chats'
import type { AIMemoryService } from './memory'

export function listAIMemoriesWithSourceStatus(
  memoryService: AIMemoryService,
  aiChatManager: AIChatManager,
  scope?: AIMemoryScope
): AIMemoryManagementEntry[] {
  return memoryService.list(scope).map((entry) => ({
    ...entry,
    sourceStatus: resolveAIMemorySourceStatus(entry, aiChatManager),
  }))
}

export function linkAIMemorySources(
  memoryService: AIMemoryService,
  aiChatManager: AIChatManager,
  input: LinkAIMemorySourcesInput,
  options?: { expectedParentMessageId?: string | null }
): LinkAIMemorySourcesResult {
  const aiChatId = requireId(input.aiChatId, 'aiChatId')
  const conversation = aiChatManager.getAIChat(aiChatId)
  if (!conversation || conversation.kind !== 'global') {
    throw new Error('Global AI conversation not found')
  }

  const userMessage = requireSourceMessage(aiChatManager, input.userMessageId, aiChatId, 'user')
  const assistantMessage = requireSourceMessage(aiChatManager, input.assistantMessageId, aiChatId, 'assistant')
  if (assistantMessage.parentId !== userMessage.id) {
    throw new Error('Assistant source message must directly reply to the user source message')
  }
  if (
    options &&
    options.expectedParentMessageId !== undefined &&
    userMessage.parentId !== options.expectedParentMessageId
  ) {
    throw new Error('User source message does not belong to the requested agent turn')
  }
  const memoryIds = normalizeMemoryIds(input.memoryIds)
  const memories = memoryIds.map((id) => ({ id, entry: memoryService.get(id) }))

  for (const { entry } of memories) {
    if (entry && entry.sourceAIChatId !== aiChatId) {
      throw new Error('AI memory does not belong to the requested conversation')
    }
    if (entry?.sourceMessageId) {
      const expectedSourceMessageId = entry.sourceType === 'user' ? userMessage.id : assistantMessage.id
      if (entry.sourceMessageId !== expectedSourceMessageId) {
        throw new Error('AI memory is already linked to another source message')
      }
    }
  }

  const skippedMemoryIds: string[] = []
  const links: Array<{ id: string; sourceAIChatId: string; sourceMessageId: string }> = []
  for (const { id, entry } of memories) {
    if (!entry) {
      skippedMemoryIds.push(id)
      continue
    }

    const sourceMessage = entry.sourceType === 'user' ? userMessage : assistantMessage
    links.push({ id, sourceAIChatId: aiChatId, sourceMessageId: sourceMessage.id })
  }

  const linkedMemoryIds = memoryService.linkSourceMessages(links)
  return { linkedMemoryIds, skippedMemoryIds }
}

export function resolveAIMemorySourceStatus(entry: AIMemoryEntry, aiChatManager: AIChatManager): AIMemorySourceStatus {
  if (!entry.sourceAIChatId) return 'none'

  const conversation = aiChatManager.getAIChat(entry.sourceAIChatId)
  if (!conversation || conversation.kind !== 'global') return 'unavailable'
  if (!entry.sourceMessageId) return 'conversation'

  const message = aiChatManager.getMessage(entry.sourceMessageId)
  const expectedRole = entry.sourceType === 'user' ? 'user' : 'assistant'
  return message?.aiChatId === entry.sourceAIChatId && message.role === expectedRole ? 'message' : 'unavailable'
}

function requireSourceMessage(
  aiChatManager: AIChatManager,
  messageId: string,
  aiChatId: string,
  role: AIMessage['role']
): AIMessage {
  const normalizedMessageId = requireId(messageId, `${role}MessageId`)
  const message = aiChatManager.getMessage(normalizedMessageId)
  if (!message || message.aiChatId !== aiChatId || message.role !== role) {
    throw new Error(`${role} source message does not belong to the requested conversation`)
  }
  return message
}

function normalizeMemoryIds(memoryIds: string[]): string[] {
  if (!Array.isArray(memoryIds)) throw new Error('memoryIds must be an array')
  return [...new Set(memoryIds.map((id) => requireId(id, 'memoryId')))]
}

function requireId(value: string, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new Error(`${field} is required`)
  return normalized
}
