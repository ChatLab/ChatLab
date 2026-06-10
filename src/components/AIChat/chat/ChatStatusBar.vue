<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { usePromptStore } from '@/stores/prompt'
import { useLayoutStore } from '@/stores/layout'
import { useLLMStore } from '@/stores/llm'
import { exportConversation, type ExportFormat, type ExportMessage } from '@/utils/conversationExport'
import type { AgentRuntimeStatus } from '@electron/shared/types'
import { useAIService } from '@/services'
import { getSupportedThinkingLevels, type ThinkingLevel } from '@openchatlab/core'
import { useCacheService } from '@/services/cache/service'

const { t } = useI18n()
const toast = useToast()
const layoutStore = useLayoutStore()

// Props
const props = defineProps<{
  sessionTokenUsage: { totalTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
  agentStatus?: AgentRuntimeStatus | null
  currentAIChatId?: string | null
  estimatedContextTokens?: number
}>()

// Store
const promptStore = usePromptStore()
const llmStore = useLLMStore()
const { aiGlobalSettings } = storeToRefs(promptStore)
const { defaultAssistantConfig, isLoading: isLoadingLLM } = storeToRefs(llmStore)

const isOpeningLog = ref(false)

const agentPhaseText = computed(() => {
  if (!props.agentStatus) return ''
  return t(`ai.chat.statusBar.agent.phase.${props.agentStatus.phase}`)
})

const agentPhaseShortText = computed(() => {
  if (!props.agentStatus) return ''
  return t(`ai.chat.statusBar.agent.phaseShort.${props.agentStatus.phase}`)
})

const agentPhaseClass = computed(() => {
  if (!props.agentStatus) return 'text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-300'

  switch (props.agentStatus.phase) {
    case 'compressing':
      return 'text-purple-600 bg-purple-50 dark:bg-purple-900/30 dark:text-purple-300'
    case 'tool_running':
      return 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-300'
    case 'thinking':
      return 'text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-300'
    case 'responding':
      return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300'
    case 'completed':
      return 'text-green-600 bg-green-50 dark:bg-green-900/30 dark:text-green-300'
    case 'aborted':
      return 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300'
    case 'error':
      return 'text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300'
    default:
      return 'text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-300'
  }
})

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return new Intl.NumberFormat().format(Math.max(0, Math.round(value)))
}

function formatCompactNumber(value: number): string {
  const num = Math.max(0, Math.round(value))
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(num)
}

const totalTokenUsageText = computed(() => formatNumber(props.sessionTokenUsage.totalTokens))
const totalTokenUsageCompactText = computed(() => formatCompactNumber(props.sessionTokenUsage.totalTokens))

const hasCacheData = computed(() => props.sessionTokenUsage.cacheReadTokens > 0)
const cacheReadText = computed(() => formatCompactNumber(props.sessionTokenUsage.cacheReadTokens))

const contextTokens = computed(() => {
  if (props.agentStatus?.contextTokens) return props.agentStatus.contextTokens
  if (props.estimatedContextTokens && props.estimatedContextTokens > 0) return props.estimatedContextTokens
  return 0
})

const modelContextWindow = computed(() => {
  const defaultConfig = defaultAssistantConfig.value
  const modelId = llmStore.defaultAssistant?.modelId || defaultConfig?.model
  if (!defaultConfig || !modelId) return 128000

  const model = llmStore.getModelById(defaultConfig.provider, modelId) || llmStore.findModelAcrossProviders(modelId)
  return model?.contextWindow ?? 128000
})

const contextUsagePercent = computed(() => {
  if (contextTokens.value <= 0 || modelContextWindow.value <= 0) return 0
  return Math.min(100, Math.round((contextTokens.value / modelContextWindow.value) * 100))
})

const contextBarColor = computed(() => {
  const pct = contextUsagePercent.value
  if (pct >= 80) return 'bg-red-500'
  if (pct >= 60) return 'bg-amber-500'
  return 'bg-emerald-500'
})

const agentCompactTitle = computed(() => {
  if (!props.agentStatus) return ''
  return [
    `${t('ai.chat.statusBar.agent.label')}: ${agentPhaseText.value}`,
    `${t('ai.chat.statusBar.agent.contextTokens')}: ${formatNumber(props.agentStatus.contextTokens)}`,
    `${t('ai.chat.statusBar.tokenUsageTitle')}: ${totalTokenUsageText.value}`,
  ].join('\n')
})

function openChatSettings() {
  layoutStore.openSettings('ai', 'chat')
}

function openModelSettings() {
  layoutStore.openSettings('ai', 'defaultModel')
}

// 导出当前对话
const isExporting = ref(false)

async function handleExportConversation() {
  if (isExporting.value || !props.currentAIChatId) return

  isExporting.value = true
  try {
    const [conv, messages] = await Promise.all([
      useAIService().getAIChat(props.currentAIChatId),
      useAIService().getMessages(props.currentAIChatId),
    ])

    if (!conv || messages.length === 0) {
      toast.warn(t('ai.chat.conversation.export.noMessages'))
      return
    }

    const format = (aiGlobalSettings.value.exportFormat || 'markdown') as ExportFormat
    const title = conv.title || t('ai.chat.conversation.newChat')
    const labels = {
      createdAt: t('ai.chat.conversation.export.createdAt'),
      user: t('ai.chat.conversation.export.user'),
      assistant: t('ai.chat.conversation.export.assistant'),
    }
    // 导出面向用户可见的问答内容，跳过压缩摘要等系统生成的内部消息。
    const messagesWithMs: ExportMessage[] = messages
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({
        role: msg.role as ExportMessage['role'],
        content: msg.content,
        timestamp: msg.timestamp * 1000,
      }))

    const result = await exportConversation(title, messagesWithMs, conv.createdAt * 1000, format, labels)

    if (result.success && result.filePath) {
      const filename = result.filePath.split('/').pop() || result.filePath
      const exportedFilePath = result.filePath
      toast.add({
        title: t('common.exportSuccess'),
        description: filename,
        color: 'primary',
        actions: [
          {
            label: t('common.openFolder'),
            onClick: () => {
              useCacheService().showInFolder(exportedFilePath)
            },
          },
        ],
      })
    } else {
      toast.fail(t('common.exportFailed'), { description: result.error })
    }
  } catch (error) {
    console.error('导出对话失败：', error)
    toast.fail(t('common.exportFailed'), { description: String(error) })
  } finally {
    isExporting.value = false
  }
}

// 打开当前 AI 日志文件并定位到文件
async function openAiLogFile() {
  if (isOpeningLog.value) return
  isOpeningLog.value = true
  try {
    const result = await useAIService().showAiLogFile()
    if (!result?.success) {
      toast.fail(t('ai.chat.statusBar.log.openFailed'), {
        description: result?.error || t('ai.chat.statusBar.log.openFailedDesc'),
      })
    }
  } catch (error) {
    console.error('打开 AI 日志失败：', error)
    toast.fail(t('ai.chat.statusBar.log.openFailed'), { description: String(error) })
  } finally {
    isOpeningLog.value = false
  }
}

// ── Thinking level selector ───────────────────────────────────────────────────

const isThinkingPopoverOpen = ref(false)

/** The current model's supported thinking levels (empty = not a reasoning model). */
const supportedThinkingLevels = computed<ThinkingLevel[]>(() => {
  const cfg = defaultAssistantConfig.value
  const modelId = llmStore.defaultAssistant?.modelId || cfg?.model
  if (!cfg?.provider || !modelId) return []
  return getSupportedThinkingLevels(cfg.provider, modelId)
})

/** Whether to show the selector at all. */
const showThinkingSelector = computed(() => supportedThinkingLevels.value.length > 0)

/** The currently remembered level for this model slot (undefined → 'default'). */
const currentThinkingLevel = computed<ThinkingLevel>(() => {
  const cfg = llmStore.defaultAssistant
  if (!cfg?.configId || !cfg?.modelId) return 'default'
  return promptStore.getThinkingLevel(cfg.configId, cfg.modelId) ?? 'default'
})

function selectThinkingLevel(level: ThinkingLevel) {
  const cfg = llmStore.defaultAssistant
  if (!cfg?.configId || !cfg?.modelId) return
  promptStore.setThinkingLevel(cfg.configId, cfg.modelId, level)
  isThinkingPopoverOpen.value = false
}

/** Label shown on the trigger button. */
const thinkingLevelLabel = computed(() => {
  return t(`ai.chat.statusBar.thinking.level.${currentThinkingLevel.value}`)
})
</script>

<template>
  <!-- 抬高状态栏与模型下拉层级，避免被输入框上方的快捷提示遮住。 -->
  <div class="relative z-20 flex items-center justify-between">
    <!-- 左侧：模型切换器 -->
    <div class="flex items-center gap-1">
      <button
        class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        :disabled="isLoadingLLM"
        @click="openModelSettings"
      >
        <UIcon name="i-heroicons-cpu-chip" class="h-3.5 w-3.5" />
        <span class="max-w-[160px] truncate">
          {{
            llmStore.defaultAssistant?.modelId
              ? llmStore.getModelById(defaultAssistantConfig?.provider ?? '', llmStore.defaultAssistant.modelId)
                  ?.name || llmStore.defaultAssistant.modelId
              : t('ai.chat.statusBar.model.notConfigured')
          }}
        </span>
      </button>

      <!-- 思考强度选择器（仅对 reasoning 模型显示） -->
      <UPopover v-if="showThinkingSelector" v-model:open="isThinkingPopoverOpen" :ui="{ content: 'z-[80] p-0' }">
        <button
          class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
          :class="
            currentThinkingLevel === 'default' || currentThinkingLevel === 'off'
              ? 'text-gray-400 dark:text-gray-500'
              : 'text-primary-500 dark:text-primary-400'
          "
          :title="t('ai.chat.statusBar.thinking.tooltip')"
        >
          <UIcon name="i-heroicons-light-bulb" class="h-3.5 w-3.5" />
          <span>{{ thinkingLevelLabel }}</span>
        </button>
        <template #content>
          <div class="w-40 py-1">
            <div class="px-3 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-500">
              {{ t('ai.chat.statusBar.thinking.title') }}
            </div>
            <button
              v-for="level in supportedThinkingLevels"
              :key="level"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
              :class="
                currentThinkingLevel === level
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-gray-700 dark:text-gray-300'
              "
              @click="selectThinkingLevel(level)"
            >
              <UIcon
                :name="currentThinkingLevel === level ? 'i-heroicons-check-circle-solid' : 'i-heroicons-light-bulb'"
                class="h-4 w-4 shrink-0"
                :class="currentThinkingLevel === level ? 'text-primary-500' : 'text-gray-400'"
              />
              <span>{{ t(`ai.chat.statusBar.thinking.level.${level}`) }}</span>
            </button>
          </div>
        </template>
      </UPopover>
    </div>

    <!-- 右侧：配置状态指示 -->
    <div class="flex items-center gap-1">
      <div
        v-if="agentStatus"
        class="hidden shrink-0 items-center gap-1 rounded-lg bg-gray-50/90 px-1.5 py-1 text-xs shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)] dark:bg-gray-800/70 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] lg:flex"
        :title="agentCompactTitle"
      >
        <!-- 主栏只展示阶段，context token 放进 tooltip，避免和累计 token 混淆。 -->
        <span class="rounded px-1 py-0.5 text-[10px] font-medium" :class="agentPhaseClass">
          {{ agentPhaseShortText }}
        </span>
      </div>

      <!-- Context 进度条 -->
      <UTooltip v-if="contextTokens > 0" :ui="{ content: 'h-auto py-1.5' }">
        <div
          class="hidden shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-gray-400 dark:text-gray-500 md:flex"
        >
          <div class="h-1.5 w-10 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              class="h-full rounded-full transition-all duration-300"
              :class="contextBarColor"
              :style="{ width: `${contextUsagePercent}%` }"
            />
          </div>
          <span class="text-[10px]">{{ contextUsagePercent }}%</span>
        </div>
        <template #content>
          <div class="space-y-0.5 whitespace-nowrap text-xs">
            <div>
              {{ t('ai.chat.statusBar.agent.contextTokens') }}: {{ formatCompactNumber(contextTokens) }} /
              {{ formatCompactNumber(modelContextWindow) }}
            </div>
            <div>{{ t('ai.chat.statusBar.tokenUsageTitle') }}: {{ totalTokenUsageCompactText }}</div>
            <div v-if="hasCacheData">
              {{ t('ai.chat.statusBar.cacheHit') }}: {{ cacheReadText }}
            </div>
          </div>
        </template>
      </UTooltip>

      <!-- 消息条数限制（点击跳转设置） -->
      <button
        class="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        :title="t('ai.chat.statusBar.messageLimit.title')"
        @click="openChatSettings"
      >
        <UIcon name="i-heroicons-adjustments-horizontal" class="h-3.5 w-3.5" />
        <span class="hidden lg:inline">{{ t('ai.chat.statusBar.messageLimit.label') }}</span>
        <span>{{ aiGlobalSettings.maxMessagesPerRequest }}</span>
      </button>
      <!-- 导出按钮 -->
      <button
        class="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        :title="t('ai.chat.statusBar.export.title')"
        :disabled="isExporting || !currentAIChatId"
        @click="handleExportConversation"
      >
        <UIcon name="i-heroicons-arrow-down-tray" class="h-3.5 w-3.5" />
        <span class="hidden xl:inline">{{ t('ai.chat.statusBar.export.label') }}</span>
      </button>
      <!-- 日志按钮 -->
      <button
        class="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        :title="t('ai.chat.statusBar.log.title')"
        :disabled="isOpeningLog"
        @click="openAiLogFile"
      >
        <UIcon name="i-heroicons-document-text" class="h-3.5 w-3.5" />
        <span class="hidden xl:inline">{{ t('ai.chat.statusBar.log.label') }}</span>
      </button>
    </div>
  </div>
</template>
