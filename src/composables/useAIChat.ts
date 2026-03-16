/**
 * AI 对话 Composable
 * 现在仅负责把指定会话绑定到全局运行时 Store，避免页面切换时丢失进行中的任务。
 */

import { toRef } from 'vue'
import { useAIChatStore } from '@/stores/aiChat'
import type {
  ChatMessage,
  SourceMessage,
  ToolStatus,
  ToolCallRecord,
  ToolBlockContent,
  MentionedMemberContext,
  ContentBlock,
  SendMessageResult,
} from '@/stores/aiChat'
import type { TokenUsage, AgentRuntimeStatus } from '@electron/shared/types'

// TokenUsage & AgentRuntimeStatus — re-export from shared/types
export type { TokenUsage, AgentRuntimeStatus }
export type {
  ChatMessage,
  SourceMessage,
  ToolStatus,
  ToolCallRecord,
  ToolBlockContent,
  MentionedMemberContext,
  ContentBlock,
  SendMessageResult,
}

export function useAIChat(
  sessionId: string,
  sessionName: string,
  timeFilter?: { startTs: number; endTs: number },
  chatType: 'group' | 'private' = 'group',
  locale: string = 'zh-CN'
) {
  const aiChatStore = useAIChatStore()
  const { chatKey, state } = aiChatStore.ensureSessionState({
    sessionId,
    sessionName,
    timeFilter,
    chatType,
    locale,
  })

  // 每次进入 AI Tab 时重置到助手选择页（从浮动任务条返回时除外）
  aiChatStore.resetToSelectorOnEnter(chatKey)

  // 当前可见的 AI 页应恢复自己的助手上下文，避免不同会话之间串助手选择。
  aiChatStore.applySessionAssistantSelection(chatKey)

  return {
    messages: toRef(state, 'messages'),
    sourceMessages: toRef(state, 'sourceMessages'),
    currentKeywords: toRef(state, 'currentKeywords'),
    isLoadingSource: toRef(state, 'isLoadingSource'),
    isAIThinking: toRef(state, 'isAIThinking'),
    showAssistantSelector: toRef(state, 'showAssistantSelector'),
    currentConversationId: toRef(state, 'currentConversationId'),
    currentToolStatus: toRef(state, 'currentToolStatus'),
    toolsUsedInCurrentRound: toRef(state, 'toolsUsedInCurrentRound'),
    sessionTokenUsage: toRef(state, 'sessionTokenUsage'),
    agentStatus: toRef(state, 'agentStatus'),
    selectedAssistantId: toRef(state, 'selectedAssistantId'),
    sendMessage: (content: string, options?: { mentionedMembers?: MentionedMemberContext[] }) =>
      aiChatStore.sendMessage(chatKey, content, options),
    loadConversation: (conversationId: string) => aiChatStore.loadConversation(chatKey, conversationId),
    startNewConversation: (welcomeMessage?: string) => aiChatStore.startNewConversation(chatKey, welcomeMessage),
    loadMoreSourceMessages: () => aiChatStore.loadMoreSourceMessages(),
    updateMaxMessages: () => aiChatStore.updateMaxMessages(),
    stopGeneration: () => aiChatStore.stopGeneration(chatKey),
    selectAssistantForSession: (assistantId: string) => aiChatStore.selectAssistantForSession(chatKey, assistantId),
    clearAssistantForSession: () => aiChatStore.clearAssistantForSession(chatKey),
  }
}
