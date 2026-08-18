<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentRuntimeStatus } from '@electron/shared/types'
import type { ToolProgress } from '@openchatlab/shared-types'

const { t, te } = useI18n()

function localizedToolName(name: string, fallback?: string): string {
  const key = `ai.assistant.builtinToolDesc.${name}`
  return te(key) ? t(key) : fallback || name
}

function localizedToolProgress(progress?: ToolProgress): string {
  if (!progress) return ''
  const key = `ai.chat.thinking.toolProgress.${progress.phase}`
  return te(key) ? t(key) : ''
}

const props = defineProps<{
  currentToolStatus: {
    name: string
    displayName: string
    status: 'running' | 'done' | 'error'
    progress?: ToolProgress
  } | null
  agentStatus?: AgentRuntimeStatus | null
}>()

const isCompressing = computed(() => props.agentStatus?.phase === 'compressing')
const showInitialShimmer = computed(() => !isCompressing.value && !props.currentToolStatus)

const title = computed(() => {
  if (isCompressing.value) return t('ai.chat.thinking.compressing')
  if (props.currentToolStatus) {
    return localizedToolName(props.currentToolStatus.name, props.currentToolStatus.displayName)
  }
  return t('ai.chat.thinking.analyzing')
})

const detail = computed(() => {
  if (isCompressing.value || !props.currentToolStatus) return ''
  if (props.currentToolStatus.status === 'running') {
    return localizedToolProgress(props.currentToolStatus.progress)
  }
  if (props.currentToolStatus.status === 'done') return t('ai.chat.thinking.processingResult')
  return ''
})

const icon = computed(() => {
  if (isCompressing.value || props.currentToolStatus?.status === 'running') return 'i-heroicons-arrow-path'
  if (props.currentToolStatus?.status === 'error') return 'i-heroicons-exclamation-circle'
  if (props.currentToolStatus) return 'i-heroicons-wrench-screwdriver'
  return 'i-heroicons-sparkles'
})

const isIconSpinning = computed(() => isCompressing.value || props.currentToolStatus?.status === 'running')
</script>

<template>
  <div
    class="ai-live-row flex h-6 min-w-0 items-center gap-1.5 text-sm leading-6 text-gray-500 dark:text-gray-400"
    :data-running="showInitialShimmer || undefined"
  >
    <UIcon
      :name="icon"
      class="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-gray-500"
      :class="[isIconSpinning ? 'animate-spin text-primary-500 dark:text-primary-400' : '']"
    />
    <span class="min-w-0 truncate">
      <span class="text-gray-600 dark:text-gray-300">{{ title }}</span>
      <span v-if="detail" class="text-gray-400 dark:text-gray-500">· {{ detail }}</span>
    </span>
  </div>
</template>
