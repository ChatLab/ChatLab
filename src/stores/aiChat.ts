/**
 * AI 对话运行时 Store
 * 将流式对话状态提升到全局，并为每个 conversation 单独维护消息缓冲，
 * 这样页面切换或切换其他对话时，后台推理仍能持续写回正确的会话。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { usePromptStore } from '@/stores/prompt'
import { useSessionStore } from '@/stores/session'
import { useSettingsStore } from '@/stores/settings'
import { useAssistantStore } from '@/stores/assistant'
import { useSkillStore } from '@/stores/skill'
import type { TokenUsage, AgentRuntimeStatus } from '@electron/shared/types'

// 工具调用记录
export interface ToolCallRecord {
  name: string
  displayName: string
  status: 'running' | 'done' | 'error'
  timestamp: number
  /** 工具调用参数（如搜索关键词等） */
  params?: Record<string, unknown>
}

export interface ToolBlockContent {
  name: string
  displayName: string
  status: 'running' | 'done' | 'error'
  params?: Record<string, unknown>
  durationMs?: number
}

export interface MentionedMemberContext {
  memberId: number
  platformId: string
  displayName: string
  aliases: string[]
  mentionText: string
}

// 内容块类型（用于 AI 消息的流式混合渲染）
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'think'; tag: string; text: string; durationMs?: number }
  | {
      type: 'tool'
      tool: ToolBlockContent
    }
  | { type: 'skill'; skillId: string; skillName: string }

// 消息类型
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  dataSource?: {
    toolsUsed: string[]
    toolRounds: number
  }
  /** @deprecated 使用 contentBlocks 替代 */
  toolCalls?: ToolCallRecord[]
  /** AI 消息的内容块数组（按时序排列的文本和工具调用） */
  contentBlocks?: ContentBlock[]
  isStreaming?: boolean
}

// 搜索结果消息类型（保留用于数据源面板）
export interface SourceMessage {
  id: number
  senderName: string
  senderPlatformId: string
  content: string
  timestamp: number
  type: number
}

// 工具状态类型
export interface ToolStatus {
  name: string
  displayName: string
  status: 'running' | 'done' | 'error'
  result?: unknown
}

interface OwnerInfo {
  platformId: string
  displayName: string
}

interface ConversationBuffer {
  messages: ChatMessage[]
  sourceMessages: SourceMessage[]
  currentKeywords: string[]
  assistantId: string | null
  loaded: boolean
}

export interface AIChatSessionState {
  sessionId: string
  sessionName: string
  chatType: 'group' | 'private'
  locale: string
  timeFilter?: { startTs: number; endTs: number }
  selectedAssistantId: string | null
  showAssistantSelector: boolean
  messages: ChatMessage[]
  sourceMessages: SourceMessage[]
  currentKeywords: string[]
  isLoadingSource: boolean
  isAIThinking: boolean
  currentConversationId: string | null
  currentToolStatus: ToolStatus | null
  toolsUsedInCurrentRound: string[]
  sessionTokenUsage: TokenUsage
  agentStatus: AgentRuntimeStatus | null
  ownerInfo?: OwnerInfo
  ownerInfoInitialized: boolean
  isAborted: boolean
  currentRequestId: string
  currentAgentRequestId: string
  conversationBuffers: Record<string, ConversationBuffer>
}

export interface AIBackgroundTask {
  requestId: string
  chatKey: string
  sessionId: string
  sessionName: string
  chatType: 'group' | 'private'
  conversationId: string | null
  questionPreview: string
  startedAt: number
}

export interface EnsureAIChatSessionParams {
  sessionId: string
  sessionName: string
  chatType: 'group' | 'private'
  locale: string
  timeFilter?: { startTs: number; endTs: number }
}

export interface SendMessageResult {
  success: boolean
  reason?: 'busy' | 'empty' | 'no_config' | 'error' | 'aborted'
  activeTask?: AIBackgroundTask | null
}

const DRAFT_CONVERSATION_KEY = '__draft__'

/**
 * 创建对话时前端已经知道 locale，因此默认助手在这里选择即可。
 */
function getDefaultGeneralAssistantId(locale: string): 'general_cn' | 'general_en' | 'general_ja' {
  if (locale.startsWith('en')) return 'general_en'
  if (locale.startsWith('ja')) return 'general_ja'
  return 'general_cn'
}

function buildTimeFilterKey(timeFilter?: { startTs: number; endTs: number }): string {
  if (!timeFilter) return 'all'
  return `${timeFilter.startTs}_${timeFilter.endTs}`
}

export function buildAIChatKey(params: {
  sessionId: string
  chatType: 'group' | 'private'
  timeFilter?: { startTs: number; endTs: number }
}): string {
  return `${params.sessionId}:${params.chatType}:${buildTimeFilterKey(params.timeFilter)}`
}

function createEmptyTokenUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
}

function createConversationBuffer(assistantId: string | null = null): ConversationBuffer {
  return {
    messages: [],
    sourceMessages: [],
    currentKeywords: [],
    assistantId,
    loaded: false,
  }
}

function createSessionState(params: EnsureAIChatSessionParams): AIChatSessionState {
  const draftBuffer = createConversationBuffer(null)
  return {
    sessionId: params.sessionId,
    sessionName: params.sessionName,
    chatType: params.chatType,
    locale: params.locale,
    timeFilter: params.timeFilter,
    selectedAssistantId: null,
    showAssistantSelector: true,
    messages: draftBuffer.messages,
    sourceMessages: draftBuffer.sourceMessages,
    currentKeywords: draftBuffer.currentKeywords,
    isLoadingSource: false,
    isAIThinking: false,
    currentConversationId: null,
    currentToolStatus: null,
    toolsUsedInCurrentRound: [],
    sessionTokenUsage: createEmptyTokenUsage(),
    agentStatus: null,
    ownerInfo: undefined,
    ownerInfoInitialized: false,
    isAborted: false,
    currentRequestId: '',
    currentAgentRequestId: '',
    conversationBuffers: {
      [DRAFT_CONVERSATION_KEY]: draftBuffer,
    },
  }
}

function getDisplayedBufferKey(state: AIChatSessionState): string {
  return state.currentConversationId ?? DRAFT_CONVERSATION_KEY
}

export const useAIChatStore = defineStore('aiChatRuntime', () => {
  const sessionStates = ref<Record<string, AIChatSessionState>>({})
  const activeTask = ref<AIBackgroundTask | null>(null)

  const promptStore = usePromptStore()
  const sessionStore = useSessionStore()
  const settingsStore = useSettingsStore()
  const assistantStore = useAssistantStore()
  const skillStore = useSkillStore()
  const { aiGlobalSettings } = storeToRefs(promptStore)

  let pendingFocusReturn = false

  function generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  function ensureSessionState(params: EnsureAIChatSessionParams): { chatKey: string; state: AIChatSessionState } {
    const chatKey = buildAIChatKey(params)
    const existing = sessionStates.value[chatKey]

    if (existing) {
      existing.sessionName = params.sessionName
      existing.chatType = params.chatType
      existing.locale = params.locale
      existing.timeFilter = params.timeFilter
      return { chatKey, state: existing }
    }

    const state = createSessionState(params)
    sessionStates.value[chatKey] = state
    // 新建会话状态后，必须返回 store 中的响应式代理对象；
    // 否则首屏会绑定到原始对象，点击后要切页回来才会看到更新。
    const reactiveState = sessionStates.value[chatKey]
    void ensureOwnerInfo(chatKey)
    return { chatKey, state: reactiveState }
  }

  function getSessionState(chatKey: string): AIChatSessionState | null {
    return sessionStates.value[chatKey] ?? null
  }

  function getActiveTaskState(): AIChatSessionState | null {
    if (!activeTask.value) return null
    return getSessionState(activeTask.value.chatKey)
  }

  function getOrCreateBuffer(
    state: AIChatSessionState,
    bufferKey: string,
    assistantId: string | null = null
  ): ConversationBuffer {
    if (!state.conversationBuffers[bufferKey]) {
      state.conversationBuffers[bufferKey] = createConversationBuffer(assistantId)
    }
    return state.conversationBuffers[bufferKey]
  }

  /**
   * 将当前 UI 绑定到某个 conversation buffer。
   * 这里只切换显示，不会影响后台正在推理的 buffer。
   */
  function bindDisplayedBuffer(state: AIChatSessionState, bufferKey: string): void {
    const buffer = getOrCreateBuffer(state, bufferKey)
    state.currentConversationId = bufferKey === DRAFT_CONVERSATION_KEY ? null : bufferKey
    state.messages = buffer.messages
    state.sourceMessages = buffer.sourceMessages
    state.currentKeywords = buffer.currentKeywords
    state.selectedAssistantId = buffer.assistantId
    state.showAssistantSelector = bufferKey === DRAFT_CONVERSATION_KEY && !buffer.assistantId
  }

  function renameBufferKey(state: AIChatSessionState, fromKey: string, toKey: string): ConversationBuffer {
    const buffer = getOrCreateBuffer(state, fromKey)
    state.conversationBuffers[toKey] = buffer
    if (fromKey !== toKey) {
      delete state.conversationBuffers[fromKey]
    }
    if (state.currentConversationId === null && fromKey === DRAFT_CONVERSATION_KEY) {
      state.currentConversationId = toKey
    }
    return buffer
  }

  function applySessionAssistantSelection(chatKey: string): void {
    const state = getSessionState(chatKey)
    if (!state) return

    if (state.selectedAssistantId) {
      assistantStore.selectAssistant(state.selectedAssistantId)
    } else {
      assistantStore.clearSelection()
    }
  }

  async function ensureOwnerInfo(chatKey: string): Promise<void> {
    const state = getSessionState(chatKey)
    if (!state) return

    const session = sessionStore.sessions.find((item) => item.id === state.sessionId)
    const ownerId = session?.ownerId

    if (!ownerId) {
      state.ownerInfo = undefined
      state.ownerInfoInitialized = true
      return
    }

    if (state.ownerInfoInitialized && state.ownerInfo?.platformId === ownerId) {
      return
    }

    try {
      const members = await window.chatApi.getMembers(state.sessionId)
      const ownerMember = members.find((member) => member.platformId === ownerId)
      state.ownerInfo = ownerMember
        ? {
            platformId: ownerId,
            displayName: ownerMember.groupNickname || ownerMember.accountName || ownerId,
          }
        : {
            platformId: ownerId,
            displayName: ownerId,
          }
      state.ownerInfoInitialized = true
    } catch (error) {
      console.error('[AI] 获取 Owner 信息失败:', error)
      state.ownerInfo = undefined
      state.ownerInfoInitialized = true
    }
  }

  function setActiveTaskMeta(
    chatKey: string,
    content: string,
    requestId: string,
    conversationId: string | null = null
  ): void {
    const state = getSessionState(chatKey)
    if (!state) return

    activeTask.value = {
      requestId,
      chatKey,
      sessionId: state.sessionId,
      sessionName: state.sessionName,
      chatType: state.chatType,
      conversationId,
      questionPreview: content.trim().slice(0, 80),
      startedAt: Date.now(),
    }
  }

  function clearActiveTask(chatKey: string, requestId?: string): void {
    if (!activeTask.value) return
    if (activeTask.value.chatKey !== chatKey) return
    if (requestId && activeTask.value.requestId !== requestId) return
    activeTask.value = null
  }

  /**
   * 会话创建成功后，把后台任务绑定到真实 conversationId。
   * 单独抽成 helper，避免在长 async 流程里触发异常的类型缩窄。
   */
  function updateActiveTaskConversationId(chatKey: string, conversationId: string): void {
    if (!activeTask.value) return
    if (activeTask.value.chatKey !== chatKey) return
    activeTask.value.conversationId = conversationId
  }

  function buildFallbackAgentStatus(state: AIChatSessionState): AgentRuntimeStatus {
    return {
      phase: 'preparing',
      round: 0,
      toolsUsed: state.toolsUsedInCurrentRound.length,
      contextTokens: 0,
      totalUsage: { ...state.sessionTokenUsage },
      updatedAt: Date.now(),
    }
  }

  function setAgentPhase(
    state: AIChatSessionState,
    phase: AgentRuntimeStatus['phase'],
    extra?: Partial<AgentRuntimeStatus>
  ): void {
    const base = state.agentStatus ? { ...state.agentStatus } : buildFallbackAgentStatus(state)
    state.agentStatus = {
      ...base,
      ...extra,
      phase,
      updatedAt: Date.now(),
    }
  }

  function selectAssistantForSession(chatKey: string, assistantId: string): boolean {
    const state = getSessionState(chatKey)
    if (!state || state.isAIThinking) return false

    const buffer = getOrCreateBuffer(state, getDisplayedBufferKey(state), assistantId)
    buffer.assistantId = assistantId
    state.selectedAssistantId = assistantId
    state.showAssistantSelector = false
    assistantStore.selectAssistant(assistantId)
    return true
  }

  function clearAssistantForSession(chatKey: string): boolean {
    const state = getSessionState(chatKey)
    if (!state || state.isAIThinking) return false

    // 返回助手选择页时切回独立草稿 buffer，不污染已有历史对话的助手绑定。
    const draftBuffer = createConversationBuffer(null)
    state.conversationBuffers[DRAFT_CONVERSATION_KEY] = draftBuffer
    bindDisplayedBuffer(state, DRAFT_CONVERSATION_KEY)
    assistantStore.clearSelection()
    return true
  }

  async function loadConversation(chatKey: string, conversationId: string): Promise<boolean> {
    const state = getSessionState(chatKey)
    if (!state) return false

    try {
      const conversation = await window.aiApi.getConversation(conversationId)
      const buffer = getOrCreateBuffer(state, conversationId, conversation?.assistantId ?? null)

      if (!buffer.loaded) {
        const history = await window.aiApi.getMessages(conversationId)
        buffer.messages.splice(
          0,
          buffer.messages.length,
          ...history.map((msg) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp * 1000,
            contentBlocks: msg.contentBlocks as ContentBlock[] | undefined,
          }))
        )
        buffer.sourceMessages.splice(0, buffer.sourceMessages.length)
        buffer.currentKeywords.splice(0, buffer.currentKeywords.length)
        buffer.loaded = true
      }

      buffer.assistantId = conversation?.assistantId ?? buffer.assistantId ?? null
      bindDisplayedBuffer(state, conversationId)
      applySessionAssistantSelection(chatKey)
      return true
    } catch (error) {
      console.error('[AI] 加载对话历史失败：', error)
      return false
    }
  }

  function focusConversation(chatKey: string, conversationId: string | null): boolean {
    const state = getSessionState(chatKey)
    if (!state) return false

    const bufferKey = conversationId ?? DRAFT_CONVERSATION_KEY
    if (!state.conversationBuffers[bufferKey]) {
      return false
    }

    bindDisplayedBuffer(state, bufferKey)
    applySessionAssistantSelection(chatKey)
    return true
  }

  function focusActiveTaskConversation(): boolean {
    if (!activeTask.value) return false
    pendingFocusReturn = true
    return focusConversation(activeTask.value.chatKey, activeTask.value.conversationId)
  }

  /**
   * 每次 ChatExplorer 挂载时调用，将界面重置到助手选择页。
   * 如果是从浮动任务条返回（pendingFocusReturn），则跳过重置以保留对话状态。
   */
  function resetToSelectorOnEnter(chatKey: string): void {
    if (pendingFocusReturn) {
      pendingFocusReturn = false
      return
    }
    const state = getSessionState(chatKey)
    if (!state || state.isAIThinking) return
    clearAssistantForSession(chatKey)
  }

  function startNewConversation(chatKey: string, welcomeMessage?: string): boolean {
    const state = getSessionState(chatKey)
    if (!state || state.isAIThinking) return false

    const draftBuffer = createConversationBuffer(state.selectedAssistantId)
    state.conversationBuffers[DRAFT_CONVERSATION_KEY] = draftBuffer
    bindDisplayedBuffer(state, DRAFT_CONVERSATION_KEY)
    state.showAssistantSelector = false
    state.currentToolStatus = null
    state.toolsUsedInCurrentRound = []
    state.isLoadingSource = false
    state.sessionTokenUsage = createEmptyTokenUsage()
    state.agentStatus = null
    state.isAborted = false
    state.currentRequestId = ''
    state.currentAgentRequestId = ''

    if (welcomeMessage) {
      draftBuffer.messages.push({
        id: generateId('welcome'),
        role: 'assistant',
        content: welcomeMessage,
        timestamp: Date.now(),
      })
    }

    return true
  }

  async function loadMoreSourceMessages(): Promise<void> {
    // Agent 模式下暂不支持加载更多
  }

  async function updateMaxMessages(): Promise<void> {
    // Agent 模式下由工具自行控制
  }

  async function sendMessage(
    chatKey: string,
    content: string,
    options?: { mentionedMembers?: MentionedMemberContext[] }
  ): Promise<SendMessageResult> {
    const state = getSessionState(chatKey)
    if (!state) {
      return { success: false, reason: 'error' }
    }

    if (!content.trim()) {
      return { success: false, reason: 'empty' }
    }

    if (state.isAIThinking || activeTask.value) {
      return { success: false, reason: 'busy', activeTask: activeTask.value }
    }

    const thisRequestId = generateId('req')
    const initialBufferKey = getDisplayedBufferKey(state)
    let resolvedConversationId = initialBufferKey === DRAFT_CONVERSATION_KEY ? null : initialBufferKey
    const targetBuffer = getOrCreateBuffer(state, initialBufferKey, state.selectedAssistantId)

    targetBuffer.assistantId = state.selectedAssistantId
    targetBuffer.loaded = true

    setActiveTaskMeta(chatKey, content, thisRequestId, resolvedConversationId)
    applySessionAssistantSelection(chatKey)
    void ensureOwnerInfo(chatKey)

    const currentSkillId = skillStore.activeSkillId
    const currentSkillName = skillStore.activeSkill?.name
    const autoSkillEnabled = aiGlobalSettings.value.enableAutoSkill ?? true
    const currentMentionedMembers = (options?.mentionedMembers ?? []).map((member) => ({
      memberId: member.memberId,
      platformId: member.platformId,
      displayName: member.displayName,
      aliases: [...member.aliases],
      mentionText: member.mentionText,
    }))

    state.isAIThinking = true
    state.isLoadingSource = true
    state.currentToolStatus = null
    state.toolsUsedInCurrentRound = []
    state.agentStatus = null
    state.isAborted = false
    state.currentRequestId = thisRequestId
    state.currentAgentRequestId = ''

    try {
      const hasConfig = await window.llmApi.hasConfig()
      if (state.isAborted) {
        clearActiveTask(chatKey, thisRequestId)
        return { success: false, reason: 'aborted' }
      }

      if (state.currentRequestId !== thisRequestId) {
        clearActiveTask(chatKey, thisRequestId)
        return { success: false, reason: 'busy', activeTask: activeTask.value }
      }

      if (!hasConfig) {
        targetBuffer.messages.push({
          id: generateId('error'),
          role: 'assistant',
          content: '⚠️ 请先配置 AI 服务。点击左下角「设置」按钮前往「模型配置Tab」进行配置。',
          timestamp: Date.now(),
        })
        clearActiveTask(chatKey, thisRequestId)
        return { success: false, reason: 'no_config' }
      }

      const userMessage: ChatMessage = {
        id: generateId('user'),
        role: 'user',
        content,
        timestamp: Date.now(),
        toolCalls: [],
      }
      targetBuffer.messages.push(userMessage)

      const aiMessage: ChatMessage = {
        id: generateId('ai'),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
        contentBlocks: [],
      }
      if (currentSkillId && currentSkillName) {
        aiMessage.contentBlocks!.push({
          type: 'skill',
          skillId: currentSkillId,
          skillName: currentSkillName,
        })
      }
      targetBuffer.messages.push(aiMessage)
      const aiMessageIndex = targetBuffer.messages.length - 1
      let hasStreamError = false

      const updateAIMessage = (updates: Partial<ChatMessage>) => {
        targetBuffer.messages[aiMessageIndex] = {
          ...targetBuffer.messages[aiMessageIndex],
          ...updates,
        }
      }

      const appendTextToBlocks = (text: string) => {
        if (!text) return

        const blocks = targetBuffer.messages[aiMessageIndex].contentBlocks || []
        const lastBlock = blocks[blocks.length - 1]

        if (text.trim().length === 0 && (!lastBlock || lastBlock.type !== 'text')) {
          return
        }

        if (lastBlock && lastBlock.type === 'text') {
          lastBlock.text += text
        } else {
          blocks.push({ type: 'text', text })
        }

        updateAIMessage({
          contentBlocks: [...blocks],
          content: targetBuffer.messages[aiMessageIndex].content + text,
        })
      }

      const appendThinkToBlocks = (text: string, tag?: string, durationMs?: number) => {
        if (!text && durationMs === undefined) return

        const blocks = targetBuffer.messages[aiMessageIndex].contentBlocks || []
        const thinkTag = tag || 'think'
        const lastBlock = blocks[blocks.length - 1]

        let targetBlock = lastBlock
        if (lastBlock && lastBlock.type === 'think' && lastBlock.tag === thinkTag) {
          lastBlock.text += text
        } else if (text.trim().length > 0) {
          targetBlock = { type: 'think', tag: thinkTag, text }
          blocks.push(targetBlock)
        } else if (durationMs !== undefined) {
          for (let index = blocks.length - 1; index >= 0; index--) {
            const block = blocks[index]
            if (block.type === 'think' && block.tag === thinkTag) {
              targetBlock = block
              break
            }
          }
        }

        if (durationMs !== undefined && targetBlock && targetBlock.type === 'think') {
          targetBlock.durationMs = durationMs
        }

        updateAIMessage({ contentBlocks: [...blocks] })
      }

      const addToolBlock = (toolName: string, params?: Record<string, unknown>) => {
        const blocks = targetBuffer.messages[aiMessageIndex].contentBlocks || []
        blocks.push({
          type: 'tool',
          tool: {
            name: toolName,
            displayName: toolName,
            status: 'running',
            params,
          },
        })
        updateAIMessage({ contentBlocks: [...blocks] })
      }

      const updateToolBlockStatus = (toolName: string, status: 'done' | 'error') => {
        const blocks = targetBuffer.messages[aiMessageIndex].contentBlocks || []
        for (let index = blocks.length - 1; index >= 0; index--) {
          const block = blocks[index]
          if (block.type === 'tool' && block.tool.name === toolName && block.tool.status === 'running') {
            block.tool.status = status
            break
          }
        }
        updateAIMessage({ contentBlocks: [...blocks] })
      }

      const currentAssistantId = targetBuffer.assistantId ?? getDefaultGeneralAssistantId(state.locale)
      if (!resolvedConversationId) {
        const title = content.slice(0, 50) + (content.length > 50 ? '...' : '')
        const conversation = await window.aiApi.createConversation(state.sessionId, title, currentAssistantId)
        if (state.isAborted) {
          updateAIMessage({ isStreaming: false })
          clearActiveTask(chatKey, thisRequestId)
          return { success: false, reason: 'aborted' }
        }

        if (state.currentRequestId !== thisRequestId) {
          updateAIMessage({ isStreaming: false })
          clearActiveTask(chatKey, thisRequestId)
          return { success: false, reason: 'busy', activeTask: activeTask.value }
        }

        resolvedConversationId = conversation.id
        renameBufferKey(state, DRAFT_CONVERSATION_KEY, conversation.id)
        targetBuffer.assistantId = currentAssistantId
        updateActiveTaskConversationId(chatKey, conversation.id)
      }

      const maxHistoryRounds = aiGlobalSettings.value.maxHistoryRounds ?? 5
      const preprocessConfig = settingsStore.aiPreprocessConfig
      const hasPreprocess =
        preprocessConfig.dataCleaning ||
        preprocessConfig.mergeConsecutive ||
        preprocessConfig.blacklistKeywords.length > 0 ||
        preprocessConfig.denoise ||
        preprocessConfig.desensitize ||
        preprocessConfig.anonymizeNames

      const serializablePreprocessConfig = hasPreprocess
        ? {
            dataCleaning: preprocessConfig.dataCleaning,
            mergeConsecutive: preprocessConfig.mergeConsecutive,
            mergeWindowSeconds: preprocessConfig.mergeWindowSeconds,
            blacklistKeywords: [...preprocessConfig.blacklistKeywords],
            denoise: preprocessConfig.denoise,
            desensitize: preprocessConfig.desensitize,
            desensitizeRules: preprocessConfig.desensitizeRules.map((rule) => ({
              ...rule,
              locales: [...rule.locales],
            })),
            anonymizeNames: preprocessConfig.anonymizeNames,
          }
        : undefined

      const context = {
        sessionId: state.sessionId,
        conversationId: resolvedConversationId,
        timeFilter: state.timeFilter ? { startTs: state.timeFilter.startTs, endTs: state.timeFilter.endTs } : undefined,
        maxMessagesLimit: aiGlobalSettings.value.maxMessagesPerRequest,
        ownerInfo: state.ownerInfo
          ? { platformId: state.ownerInfo.platformId, displayName: state.ownerInfo.displayName }
          : undefined,
        mentionedMembers: currentMentionedMembers.length > 0 ? currentMentionedMembers : undefined,
        preprocessConfig: serializablePreprocessConfig,
      }

      const { requestId: agentReqId, promise: agentPromise } = window.agentApi.runStream(
        content,
        context,
        (chunk) => {
          if (state.isAborted || thisRequestId !== state.currentRequestId) {
            return
          }

          switch (chunk.type) {
            case 'content':
              if (chunk.content) {
                state.currentToolStatus = null
                appendTextToBlocks(chunk.content)
              }
              break

            case 'think':
              if (chunk.content) {
                appendThinkToBlocks(chunk.content, chunk.thinkTag)
              } else if (chunk.thinkDurationMs !== undefined) {
                appendThinkToBlocks('', chunk.thinkTag, chunk.thinkDurationMs)
              }
              break

            case 'tool_start':
              if (chunk.toolName) {
                const toolParams = chunk.toolParams as Record<string, unknown> | undefined
                state.currentToolStatus = {
                  name: chunk.toolName,
                  displayName: chunk.toolName,
                  status: 'running',
                }
                state.toolsUsedInCurrentRound.push(chunk.toolName)
                addToolBlock(chunk.toolName, toolParams)
              }
              break

            case 'tool_result':
              if (chunk.toolName) {
                if (state.currentToolStatus?.name === chunk.toolName) {
                  state.currentToolStatus = {
                    ...state.currentToolStatus,
                    status: 'done',
                  }
                }
                updateToolBlockStatus(chunk.toolName, 'done')
              }
              state.isLoadingSource = false
              break

            case 'status':
              if (chunk.status && (!state.agentStatus || chunk.status.updatedAt >= state.agentStatus.updatedAt)) {
                state.agentStatus = chunk.status
              }
              break

            case 'done':
              state.currentToolStatus = null
              if (chunk.usage) {
                state.sessionTokenUsage = {
                  promptTokens: state.sessionTokenUsage.promptTokens + chunk.usage.promptTokens,
                  completionTokens: state.sessionTokenUsage.completionTokens + chunk.usage.completionTokens,
                  totalTokens: state.sessionTokenUsage.totalTokens + chunk.usage.totalTokens,
                }
              }
              setAgentPhase(state, 'completed', chunk.usage ? { totalUsage: chunk.usage } : undefined)
              break

            case 'error':
              if (state.currentToolStatus) {
                state.currentToolStatus = {
                  ...state.currentToolStatus,
                  status: 'error',
                }
                updateToolBlockStatus(state.currentToolStatus.name, 'error')
              }
              if (!hasStreamError) {
                hasStreamError = true
                appendTextToBlocks(`\n\n❌ 处理失败：${chunk.error || '未知错误'}`)
                updateAIMessage({ isStreaming: false })
              }
              setAgentPhase(state, 'error')
              break
          }
        },
        state.chatType,
        state.locale,
        maxHistoryRounds,
        currentAssistantId,
        currentSkillId,
        !currentSkillId ? autoSkillEnabled : undefined
      )

      state.currentAgentRequestId = agentReqId
      setActiveTaskMeta(chatKey, content, agentReqId, resolvedConversationId)

      const result = await agentPromise
      if (state.isAborted) {
        clearActiveTask(chatKey, agentReqId)
        return { success: false, reason: 'aborted' }
      }

      if (thisRequestId !== state.currentRequestId) {
        clearActiveTask(chatKey, agentReqId)
        return { success: false, reason: 'busy', activeTask: activeTask.value }
      }

      if (result.success && result.result) {
        targetBuffer.messages[aiMessageIndex] = {
          ...targetBuffer.messages[aiMessageIndex],
          dataSource: {
            toolsUsed: result.result.toolsUsed,
            toolRounds: result.result.toolRounds,
          },
          isStreaming: false,
        }

        await saveConversation(resolvedConversationId, userMessage, targetBuffer.messages[aiMessageIndex])
      } else if (!hasStreamError) {
        appendTextToBlocks(`\n\n❌ 处理失败：${result.error || '未知错误'}`)
        targetBuffer.messages[aiMessageIndex] = {
          ...targetBuffer.messages[aiMessageIndex],
          isStreaming: false,
        }
      }

      return { success: true }
    } catch (error) {
      console.error('[AI] 处理失败：', error)
      state.agentStatus = null

      const lastMessage = targetBuffer.messages[targetBuffer.messages.length - 1]
      if (lastMessage && lastMessage.role === 'assistant') {
        lastMessage.content = `❌ 处理失败：${error instanceof Error ? error.message : '未知错误'}

请检查：
- 网络连接是否正常
- API Key 是否有效
- 配置是否正确`
        lastMessage.isStreaming = false
      }

      return { success: false, reason: 'error' }
    } finally {
      state.isAIThinking = false
      state.isLoadingSource = false
      state.currentToolStatus = null
      state.isAborted = false
      state.currentRequestId = ''
      state.currentAgentRequestId = ''
      clearActiveTask(chatKey)
    }
  }

  async function saveConversation(
    conversationId: string | null,
    userMsg: ChatMessage,
    aiMsg: ChatMessage
  ): Promise<void> {
    try {
      if (!conversationId) {
        return
      }

      await window.aiApi.addMessage(conversationId, 'user', userMsg.content)
      const serializableContentBlocks = aiMsg.contentBlocks
        ? JSON.parse(JSON.stringify(aiMsg.contentBlocks))
        : undefined
      await window.aiApi.addMessage(
        conversationId,
        'assistant',
        aiMsg.content,
        undefined,
        undefined,
        serializableContentBlocks
      )
    } catch (error) {
      console.error('[AI] 保存对话失败：', error)
    }
  }

  async function stopGeneration(chatKey: string): Promise<boolean> {
    const state = getSessionState(chatKey)
    if (!state || !state.isAIThinking) return false

    state.isAborted = true
    state.isAIThinking = false
    state.isLoadingSource = false
    state.currentToolStatus = null
    setAgentPhase(state, 'aborted')

    // 停止时优先定位真实仍在流式写入的会话缓冲，而不是当前页面正在查看的缓冲。
    const runningBufferKey =
      activeTask.value?.chatKey === chatKey
        ? (activeTask.value.conversationId ?? DRAFT_CONVERSATION_KEY)
        : getDisplayedBufferKey(state)
    const runningBuffer = state.conversationBuffers[runningBufferKey]
    const lastMessage = runningBuffer ? runningBuffer.messages[runningBuffer.messages.length - 1] : undefined
    if (lastMessage && lastMessage.role === 'assistant' && lastMessage.isStreaming) {
      lastMessage.isStreaming = false
      lastMessage.content += '\n\n_（已停止生成）_'
    }

    if (state.currentAgentRequestId) {
      try {
        await window.agentApi.abort(state.currentAgentRequestId)
      } catch (error) {
        console.error('[AI] 中止 Agent 请求失败:', error)
      }
    }

    state.currentRequestId = ''
    state.currentAgentRequestId = ''
    clearActiveTask(chatKey)
    return true
  }

  async function stopActiveTask(): Promise<boolean> {
    if (!activeTask.value) return false
    return stopGeneration(activeTask.value.chatKey)
  }

  return {
    sessionStates,
    activeTask,
    ensureSessionState,
    getSessionState,
    getActiveTaskState,
    applySessionAssistantSelection,
    selectAssistantForSession,
    clearAssistantForSession,
    loadConversation,
    focusConversation,
    focusActiveTaskConversation,
    resetToSelectorOnEnter,
    startNewConversation,
    loadMoreSourceMessages,
    updateMaxMessages,
    sendMessage,
    stopGeneration,
    stopActiveTask,
  }
})
