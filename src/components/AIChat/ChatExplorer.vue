<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@nuxt/ui/runtime/composables/useToast.js'
import ConversationList from './chat/ConversationList.vue'
import DataSourcePanel from './chat/DataSourcePanel.vue'
import ChatMessage from './chat/ChatMessage.vue'
import AIChatInput from './input/AIChatInput.vue'
import AIThinkingIndicator from './chat/AIThinkingIndicator.vue'
import ChatStatusBar from './chat/ChatStatusBar.vue'
import { useAIChat } from '@/composables/useAIChat'
import CaptureButton from '@/components/common/CaptureButton.vue'
import AssistantSelector from './assistant/AssistantSelector.vue'
import AssistantConfigModal from './assistant/AssistantConfigModal.vue'
import AssistantMarketModal from './assistant/AssistantMarketModal.vue'
import SkillMarketModal from './skill/SkillMarketModal.vue'
import SkillConfigModal from './skill/SkillConfigModal.vue'
import PresetQuestions from './input/PresetQuestions.vue'
import { usePromptStore } from '@/stores/prompt'
import { useSettingsStore } from '@/stores/settings'
import { useAssistantStore } from '@/stores/assistant'
import { useSkillStore } from '@/stores/skill'
import { useChatScroll } from './composables/useChatScroll'
import { useChatModals } from './composables/useChatModals'
import { groupMessagesToQAPairs } from './utils/chatMessages'
import type { MentionedMemberContext } from '@/composables/useAIChat'

const { t } = useI18n()
const toast = useToast()
const settingsStore = useSettingsStore()
const assistantStore = useAssistantStore()
const skillStore = useSkillStore()

// Props
const props = defineProps<{
  sessionId: string
  sessionName: string
  timeFilter?: { startTs: number; endTs: number }
  chatType?: 'group' | 'private'
}>()

// 使用 AI 对话 Composable
const {
  messages,
  sourceMessages,
  currentKeywords,
  isLoadingSource,
  isAIThinking,
  showAssistantSelector,
  currentConversationId,
  currentToolStatus,
  toolsUsedInCurrentRound,
  sessionTokenUsage,
  agentStatus,
  selectedAssistantId,
  sendMessage,
  loadConversation,
  startNewConversation,
  loadMoreSourceMessages,
  updateMaxMessages,
  stopGeneration,
  selectAssistantForSession,
  clearAssistantForSession,
} = useAIChat(props.sessionId, props.sessionName, props.timeFilter, props.chatType ?? 'group', settingsStore.locale)

// 智能滚动
const { messagesContainer, showScrollToBottom, scrollToBottom, handleScrollToBottom } = useChatScroll(
  messages,
  isAIThinking
)

// 弹窗管理
const {
  configModalVisible,
  configModalAssistantId,
  configModalReadonly,
  marketModalVisible,
  skillMarketModalVisible,
  skillConfigModalVisible,
  skillConfigModalSkillId,
  handleConfigureAssistant,
  handleOpenMarket,
  handleMarketConfigure,
  handleMarketViewConfig,
  handleCreateAssistant,
  handleAssistantCreated,
  handleAssistantConfigSaved,
  handleOpenSkillMarket,
  handleSkillMarketConfigure,
  handleCreateSkill,
  handleSkillConfigSaved,
  handleSkillCreated,
} = useChatModals()

// Store
const promptStore = usePromptStore()

// 当前选中助手的预设问题
const currentPresetQuestions = computed(() => {
  return assistantStore.selectedAssistant?.presetQuestions ?? []
})

// 当前聊天类型
const currentChatType = computed(() => props.chatType ?? 'group')

// UI 状态
const isSourcePanelCollapsed = ref(false)
const hasLLMConfig = ref(false)
const isCheckingConfig = ref(true)
const conversationListRef = ref<InstanceType<typeof ConversationList> | null>(null)
const chatInputRef = ref<{
  fillInput: (content: string) => void
  openSkillSelector: () => void
} | null>(null)

// QA 对
const qaPairs = computed(() => groupMessagesToQAPairs(messages.value))

// 截屏功能
const conversationContentRef = ref<HTMLElement | null>(null)

// 检查 LLM 配置
async function checkLLMConfig() {
  isCheckingConfig.value = true
  try {
    hasLLMConfig.value = await window.llmApi.hasConfig()
  } catch (error) {
    console.error('检查 LLM 配置失败：', error)
    hasLLMConfig.value = false
  } finally {
    isCheckingConfig.value = false
  }
}

// 刷新配置状态（供外部调用）
async function refreshConfig() {
  await checkLLMConfig()
  if (hasLLMConfig.value) {
    await updateMaxMessages()
  }
}

// 暴露方法供父组件调用
defineExpose({
  refreshConfig,
})

const welcomeInfo = computed(() => {
  const assistant = assistantStore.selectedAssistant
  if (!assistant) return { name: '', preview: '' }

  const preview = assistant.systemPrompt
    .replace(/#{1,6}\s+[^\n]*/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { name: assistant.name, preview }
})

const showWelcomeCard = computed(() => {
  return !!selectedAssistantId.value && messages.value.length === 0 && !isAIThinking.value
})

function showRunningTaskToast() {
  toast.add({
    title: t('ai.chat.backgroundTask.runningTitle'),
    description: t('ai.chat.backgroundTask.runningDescription'),
    color: 'warning',
    icon: 'i-heroicons-sparkles',
  })
}

function showLockedActionToast() {
  toast.add({
    title: t('ai.chat.backgroundTask.blockedAction'),
    color: 'warning',
    icon: 'i-heroicons-lock-closed',
  })
}

// 选择助手
function handleSelectAssistant(id: string) {
  if (!selectAssistantForSession(id)) {
    showLockedActionToast()
    return
  }
  startNewConversation()
}

// 返回助手选择
function handleBackToSelector() {
  if (!clearAssistantForSession()) {
    showLockedActionToast()
    return
  }
  skillStore.activateSkill(null)
}

async function handlePresetQuestion(question: string) {
  const result = await sendMessage(question)
  if (!result.success && result.reason === 'busy') {
    showRunningTaskToast()
  }
}

function handleUseSkillEntry() {
  chatInputRef.value?.openSkillSelector()
}

function handleSkillActivated() {
  scrollToBottom(true)
}

// 发送消息
async function handleSend(payload: { content: string; mentionedMembers: MentionedMemberContext[] }) {
  const result = await sendMessage(payload.content, { mentionedMembers: payload.mentionedMembers })
  if (!result.success) {
    if (result.reason === 'busy') {
      showRunningTaskToast()
    }
    return
  }
  scrollToBottom(true)
  conversationListRef.value?.refresh()
}

// 切换数据源面板
function toggleSourcePanel() {
  isSourcePanelCollapsed.value = !isSourcePanelCollapsed.value
}

// 加载更多数据源
async function handleLoadMore() {
  await loadMoreSourceMessages()
}

// 选择对话
async function handleSelectConversation(convId: string) {
  await loadConversation(convId)
  scrollToBottom(true)
}

// 创建新对话
function handleCreateConversation() {
  if (isAIThinking.value) {
    showLockedActionToast()
    return
  }
  if (!selectedAssistantId.value) return
  startNewConversation()
}

// 删除对话
function handleDeleteConversation(convId: string) {
  if (currentConversationId.value === convId) {
    if (selectedAssistantId.value) {
      startNewConversation()
    } else {
      clearAssistantForSession()
    }
  }
}

// 处理停止按钮
function handleStop() {
  stopGeneration()
}

// 初始化
checkLLMConfig()
updateMaxMessages()

// 监听全局 AI 配置变化（从设置弹窗保存时触发）
watch(
  () => promptStore.aiConfigVersion,
  async () => {
    await refreshConfig()
  }
)
</script>

<template>
  <div class="main-content flex h-full overflow-hidden">
    <!-- 左侧：对话记录列表（始终显示） -->
    <ConversationList
      ref="conversationListRef"
      :session-id="sessionId"
      :active-id="currentConversationId"
      :disabled="isAIThinking"
      class="h-full shrink-0"
      @select="handleSelectConversation"
      @create="handleCreateConversation"
      @delete="handleDeleteConversation"
    />

    <!-- 右侧内容区 -->
    <Transition name="fade" mode="out-in">
      <!-- 助手选择页面 -->
      <AssistantSelector
        v-if="showAssistantSelector"
        key="selector"
        class="h-full flex-1"
        :chat-type="currentChatType"
        :locale="settingsStore.locale"
        @select="handleSelectAssistant"
        @configure="handleConfigureAssistant"
        @market="handleOpenMarket"
      />

      <!-- 对话区域 -->
      <div v-else key="chat" class="flex h-full flex-1 overflow-hidden">
        <div class="flex h-full flex-1">
          <div class="relative flex min-w-[480px] flex-1 flex-col overflow-hidden">
            <!-- 顶部：返回 + 助手名称 -->
            <div class="flex items-center gap-1.5 px-3 py-1.5">
              <button
                class="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                :disabled="isAIThinking"
                :class="{ 'cursor-not-allowed opacity-50': isAIThinking }"
                @click="handleBackToSelector"
              >
                <UIcon name="i-heroicons-chevron-left" class="h-3.5 w-3.5" />
                <span>{{ assistantStore.selectedAssistant?.name || t('ai.assistant.fallbackName') }}</span>
              </button>
            </div>

            <!-- 消息列表 -->
            <div ref="messagesContainer" class="min-h-0 flex-1 overflow-y-auto p-4">
              <div ref="conversationContentRef" class="mx-auto max-w-3xl space-y-6">
                <!-- 助手欢迎卡片（仅在无消息时展示，点击可编辑配置） -->
                <div
                  v-if="showWelcomeCard && welcomeInfo.name"
                  class="cursor-pointer rounded-lg border border-gray-200 px-4 py-3 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-800/50"
                  @click="handleConfigureAssistant(assistantStore.selectedAssistant!.id)"
                >
                  <h4 class="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
                    {{ welcomeInfo.name }}
                  </h4>
                  <p class="line-clamp-2 text-xs leading-relaxed text-gray-400 dark:text-gray-500">
                    {{ welcomeInfo.preview }}
                  </p>
                </div>

                <!-- 对话截屏按钮 -->
                <div v-if="qaPairs.length > 0 && !isAIThinking" class="flex justify-end">
                  <CaptureButton
                    :label="t('ai.chat.capture')"
                    size="xs"
                    type="element"
                    :target-element="conversationContentRef"
                  />
                </div>

                <!-- QA 对渲染 -->
                <template v-for="pair in qaPairs" :key="pair.id">
                  <div class="qa-pair space-y-6 pb-4">
                    <!-- 用户问题 -->
                    <ChatMessage
                      v-if="pair.user && (pair.user.role === 'user' || pair.user.content)"
                      :role="pair.user.role"
                      :content="pair.user.content"
                      :timestamp="pair.user.timestamp"
                      :is-streaming="pair.user.isStreaming"
                      :content-blocks="pair.user.contentBlocks"
                    />
                    <!-- AI 回复 -->
                    <ChatMessage
                      v-if="
                        pair.assistant &&
                        (pair.assistant.content ||
                          (pair.assistant.contentBlocks && pair.assistant.contentBlocks.length > 0))
                      "
                      :role="pair.assistant.role"
                      :content="pair.assistant.content"
                      :timestamp="pair.assistant.timestamp"
                      :is-streaming="pair.assistant.isStreaming"
                      :content-blocks="pair.assistant.contentBlocks"
                      :show-capture-button="!pair.assistant.isStreaming"
                    />
                  </div>
                </template>

                <!-- AI 思考中指示器（仅在没有任何内容块时显示） -->
                <AIThinkingIndicator
                  v-if="
                    isAIThinking &&
                    !messages[messages.length - 1]?.content &&
                    !(messages[messages.length - 1]?.contentBlocks?.length ?? 0)
                  "
                  :current-tool-status="currentToolStatus"
                  :tools-used="toolsUsedInCurrentRound"
                />
              </div>
            </div>

            <!-- 返回底部浮动按钮（固定在输入框上方） -->
            <Transition name="fade-up">
              <button
                v-if="showScrollToBottom"
                class="absolute bottom-20 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-gray-800/90 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur-sm transition-all hover:bg-gray-700 dark:bg-gray-700/90 dark:hover:bg-gray-600"
                @click="handleScrollToBottom"
              >
                <UIcon name="i-heroicons-arrow-down" class="h-3.5 w-3.5" />
                <span>{{ t('ai.chat.scrollToBottom') }}</span>
              </button>
            </Transition>

            <!-- 预设问题气泡（仅在对话为空时显示） -->
            <div v-if="messages.length === 0 && !isAIThinking" class="px-4 pb-2">
              <div class="mx-auto max-w-3xl">
                <PresetQuestions
                  :questions="currentPresetQuestions"
                  :leading-action-label="t('ai.chat.input.useSkill')"
                  @select="handlePresetQuestion"
                  @leading-action="handleUseSkillEntry"
                />
              </div>
            </div>

            <!-- 输入框区域 -->
            <div class="px-4 pb-2">
              <div class="mx-auto max-w-3xl">
                <AIChatInput
                  ref="chatInputRef"
                  :session-id="sessionId"
                  :disabled="isAIThinking"
                  :status="isAIThinking ? 'streaming' : 'ready'"
                  :chat-type="currentChatType"
                  @send="handleSend"
                  @stop="handleStop"
                  @manage-skills="handleOpenSkillMarket"
                  @skill-activated="handleSkillActivated"
                />

                <!-- 底部状态栏 -->
                <ChatStatusBar
                  :session-token-usage="sessionTokenUsage"
                  :agent-status="agentStatus"
                  :current-conversation-id="currentConversationId"
                />
              </div>
            </div>
          </div>
          <!-- closes relative flex min-w-[480px] -->
        </div>
        <!-- closes flex h-full flex-1 -->

        <!-- 右侧：数据源面板 -->
        <Transition name="slide-fade">
          <div
            v-if="sourceMessages.length > 0 && !isSourcePanelCollapsed"
            class="w-80 shrink-0 border-l border-gray-200 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-900/50"
          >
            <DataSourcePanel
              :messages="sourceMessages"
              :keywords="currentKeywords"
              :is-loading="isLoadingSource"
              :is-collapsed="isSourcePanelCollapsed"
              class="h-full"
              @toggle="toggleSourcePanel"
              @load-more="handleLoadMore"
            />
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- 助手配置弹窗 -->
    <AssistantConfigModal
      :open="configModalVisible"
      :assistant-id="configModalAssistantId"
      :readonly="configModalReadonly"
      @update:open="configModalVisible = $event"
      @saved="handleAssistantConfigSaved"
      @created="handleAssistantCreated"
    />

    <!-- 助手管理弹窗 -->
    <AssistantMarketModal
      :open="marketModalVisible"
      @update:open="marketModalVisible = $event"
      @configure="handleMarketConfigure"
      @view-config="handleMarketViewConfig"
      @create="handleCreateAssistant"
    />

    <!-- 技能管理弹窗 -->
    <SkillMarketModal
      :open="skillMarketModalVisible"
      @update:open="skillMarketModalVisible = $event"
      @configure="handleSkillMarketConfigure"
      @create="handleCreateSkill"
    />

    <!-- 技能配置弹窗 -->
    <SkillConfigModal
      :open="skillConfigModalVisible"
      :skill-id="skillConfigModalSkillId"
      @update:open="skillConfigModalVisible = $event"
      @saved="handleSkillConfigSaved"
      @created="handleSkillCreated"
    />
  </div>
</template>

<style scoped>
/* Transition styles for slide-fade */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.3s ease-out;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateX(20px);
  opacity: 0;
}

/* Transition styles for slide-up (status bar) */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease-out;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(10px);
  opacity: 0;
}

/* Transition styles for fade-up (scroll to bottom button) */
.fade-up-enter-active,
.fade-up-leave-active {
  transition: opacity 0.2s ease-out;
}

.fade-up-enter-from,
.fade-up-leave-to {
  opacity: 0;
}
</style>
