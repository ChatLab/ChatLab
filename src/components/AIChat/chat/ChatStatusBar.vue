<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { usePromptStore } from '@/stores/prompt'
import { useLayoutStore } from '@/stores/layout'
import { useLLMStore } from '@/stores/llm'
import type { AgentRuntimeStatus } from '@electron/shared/types'
import { getSupportedThinkingLevels, type ThinkingLevel } from '@openchatlab/core'

const { t } = useI18n()
const layoutStore = useLayoutStore()

// Props
const props = defineProps<{
  sessionTokenUsage: { totalTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
  agentStatus?: AgentRuntimeStatus | null
  estimatedContextTokens?: number
}>()

// Store
const promptStore = usePromptStore()
const llmStore = useLLMStore()
const { defaultAssistantConfig, isLoading: isLoadingLLM } = storeToRefs(llmStore)

const agentPhaseText = computed(() => {
  if (!props.agentStatus) return ''
  return t(`ai.chat.statusBar.agent.phase.${props.agentStatus.phase}`)
})

const agentPhaseShortText = computed(() => {
  if (!props.agentStatus) return ''
  return t(`ai.chat.statusBar.agent.phaseShort.${props.agentStatus.phase}`)
})

const isLiveAgentPhase = computed(() => {
  const phase = props.agentStatus?.phase
  return (
    phase === 'compressing' ||
    phase === 'preparing' ||
    phase === 'thinking' ||
    phase === 'tool_running' ||
    phase === 'responding'
  )
})

const showAgentPhase = computed(() => {
  const phase = props.agentStatus?.phase
  return isLiveAgentPhase.value || phase === 'error'
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

const contextRingRadius = 5.5
const contextRingCircumference = 2 * Math.PI * contextRingRadius
const contextRingDasharray = computed(() => {
  return `${(contextRingCircumference * contextUsagePercent.value) / 100} ${contextRingCircumference}`
})

const agentCompactTitle = computed(() => {
  if (!props.agentStatus) return ''
  return [
    `${t('ai.chat.statusBar.agent.label')}: ${agentPhaseText.value}`,
    `${t('ai.chat.statusBar.agent.contextTokens')}: ${formatNumber(props.agentStatus.contextTokens)}`,
    `${t('ai.chat.statusBar.tokenUsageTitle')}: ${totalTokenUsageText.value}`,
  ].join('\n')
})

function openModelSettings() {
  layoutStore.openSettings('ai', 'defaultModel')
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
        v-if="showAgentPhase"
        class="hidden shrink-0 items-center gap-1.5 px-1.5 py-1 text-[11px] text-gray-400 lg:flex dark:text-gray-500"
        :title="agentCompactTitle"
      >
        <span
          class="h-1.5 w-1.5 rounded-full"
          :class="[agentStatus?.phase === 'error' ? 'bg-amber-500' : 'bg-primary-500 animate-pulse']"
        />
        <span>{{ agentPhaseShortText }}</span>
      </div>

      <!-- Context occupancy ring: geometry matches the DSH composer meter. -->
      <UTooltip v-if="contextTokens > 0" :ui="{ content: 'h-auto py-1.5' }">
        <div
          class="hidden h-7 w-7 shrink-0 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 md:grid dark:text-gray-500 dark:hover:bg-gray-800"
          :aria-label="`${t('ai.chat.statusBar.agent.contextTokens')} ${contextUsagePercent}%`"
        >
          <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
            <circle
              cx="7"
              cy="7"
              :r="contextRingRadius"
              fill="none"
              class="stroke-gray-300 dark:stroke-gray-700"
              stroke-width="2"
            />
            <circle
              cx="7"
              cy="7"
              :r="contextRingRadius"
              fill="none"
              class="stroke-gray-400 transition-[stroke-dasharray] duration-300 dark:stroke-gray-500"
              stroke-width="2"
              stroke-linecap="round"
              :stroke-dasharray="contextRingDasharray"
              transform="rotate(-90 7 7)"
            />
          </svg>
        </div>
        <template #content>
          <div class="space-y-0.5 whitespace-nowrap text-xs">
            <div>
              {{ t('ai.chat.statusBar.agent.contextTokens') }}: {{ formatCompactNumber(contextTokens) }} /
              {{ formatCompactNumber(modelContextWindow) }}
            </div>
            <div>{{ t('ai.chat.statusBar.tokenUsageTitle') }}: {{ totalTokenUsageCompactText }}</div>
            <div v-if="hasCacheData">{{ t('ai.chat.statusBar.cacheHit') }}: {{ cacheReadText }}</div>
          </div>
        </template>
      </UTooltip>
    </div>
  </div>
</template>
