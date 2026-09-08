<script setup lang="ts">
/**
 * 导入目标选择弹窗
 * 单文件导入时，让用户决定这次导入落到哪里：自动匹配、追加到指定会话，或新建独立会话。
 * 默认选中自动匹配的结果，直接确认即可保持原有行为。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useSessionStore } from '@/stores/session'
import type { AutoImportDecision, ImportTarget } from '@/services'

const props = defineProps<{
  open: boolean
  /** 自动匹配的结论；为空表示分析尚未完成。 */
  decision: AutoImportDecision | null
  /** 待导入文件的显示名。 */
  fileName?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: [target: ImportTarget]
  cancel: []
}>()

const { t } = useI18n()
const { sessions } = storeToRefs(useSessionStore())

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
})

const mode = ref<ImportTarget['mode']>('auto')
const selectedSessionId = ref<string | null>(null)
const sessionQuery = ref('')

const autoTargetSession = computed(() => {
  const decision = props.decision
  if (decision?.action !== 'incremental') return undefined
  return sessions.value.find((session) => session.id === decision.sessionId)
})

/** 自动匹配那一项的说明：命中已有会话就写清楚会追加到哪里，否则写清楚为什么新建。 */
const autoSummary = computed(() => {
  if (!props.decision) return t('common.loading')
  if (props.decision.action === 'incremental') {
    return t('home.import.target.autoAppend', {
      session: autoTargetSession.value?.name ?? props.decision.sessionId,
      method: t(`home.import.target.matchedBy.${props.decision.matchedBy ?? 'trailing-messages'}`),
    })
  }
  return t('home.import.target.autoCreate', {
    reason: t(`home.import.target.createReason.${props.decision.reason}`),
  })
})

const filteredSessions = computed(() => {
  const query = sessionQuery.value.trim().toLowerCase()
  if (!query) return sessions.value
  return sessions.value.filter((session) => session.name.toLowerCase().includes(query))
})

const canConfirm = computed(() => mode.value !== 'session' || Boolean(selectedSessionId.value))

watch(
  () => props.open,
  (open) => {
    if (!open) return
    sessionQuery.value = ''
    mode.value = 'auto'
    selectedSessionId.value = props.decision?.action === 'incremental' ? props.decision.sessionId : null
  }
)

watch(
  () => props.decision,
  (decision) => {
    if (props.open && !selectedSessionId.value && decision?.action === 'incremental') {
      selectedSessionId.value = decision.sessionId
    }
  }
)

function confirmSelection() {
  if (!canConfirm.value) return
  isOpen.value = false
  emit(
    'confirm',
    mode.value === 'session' ? { mode: 'session', sessionId: selectedSessionId.value! } : { mode: mode.value }
  )
}

function handleClose() {
  isOpen.value = false
  emit('cancel')
}
</script>

<template>
  <UModal v-model:open="isOpen" :title="t('home.import.target.title')">
    <template #body>
      <div class="min-h-[220px]">
        <p class="mb-3 text-sm text-gray-500 dark:text-gray-400">
          {{ fileName ? t('home.import.target.hintWithFile', { file: fileName }) : t('home.import.target.hint') }}
        </p>

        <div class="space-y-1.5">
          <button
            type="button"
            class="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors"
            :class="
              mode === 'auto'
                ? 'bg-pink-50 ring-1 ring-pink-200 dark:bg-pink-500/10 dark:ring-pink-500/30'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800'
            "
            @click="mode = 'auto'"
          >
            <div
              class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors"
              :class="mode === 'auto' ? 'border-pink-500 bg-pink-500' : 'border-gray-300 dark:border-gray-600'"
            >
              <UIcon v-if="mode === 'auto'" name="i-heroicons-check-20-solid" class="h-3 w-3 text-white" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-gray-900 dark:text-white">{{ t('home.import.target.auto') }}</p>
              <p class="text-xs text-gray-400">{{ autoSummary }}</p>
            </div>
          </button>

          <button
            type="button"
            class="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors"
            :class="
              mode === 'session'
                ? 'bg-pink-50 ring-1 ring-pink-200 dark:bg-pink-500/10 dark:ring-pink-500/30'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800'
            "
            @click="mode = 'session'"
          >
            <div
              class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors"
              :class="mode === 'session' ? 'border-pink-500 bg-pink-500' : 'border-gray-300 dark:border-gray-600'"
            >
              <UIcon v-if="mode === 'session'" name="i-heroicons-check-20-solid" class="h-3 w-3 text-white" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-gray-900 dark:text-white">{{ t('home.import.target.session') }}</p>
              <p class="text-xs text-gray-400">{{ t('home.import.target.sessionHint') }}</p>
            </div>
          </button>

          <div v-if="mode === 'session'" class="space-y-1.5 pl-7">
            <UInput
              v-model="sessionQuery"
              size="sm"
              icon="i-heroicons-magnifying-glass"
              :placeholder="t('home.import.target.searchPlaceholder')"
            />
            <p v-if="sessions.length === 0" class="px-1 py-3 text-xs text-gray-400">
              {{ t('home.import.target.noSessions') }}
            </p>
            <div v-else class="max-h-[200px] space-y-0.5 overflow-y-auto pr-1">
              <button
                v-for="session in filteredSessions"
                :key="session.id"
                type="button"
                class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors"
                :class="
                  selectedSessionId === session.id
                    ? 'bg-pink-50 dark:bg-pink-500/10'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                "
                @click="selectedSessionId = session.id"
              >
                <UIcon
                  :name="session.type === 'private' ? 'i-heroicons-user-circle' : 'i-heroicons-user-group'"
                  class="h-4 w-4 shrink-0 text-gray-400"
                />
                <span class="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-white">{{ session.name }}</span>
                <span class="shrink-0 text-xs text-gray-400">{{ session.messageCount.toLocaleString() }}</span>
              </button>
              <p v-if="filteredSessions.length === 0" class="px-1 py-3 text-xs text-gray-400">
                {{ t('home.import.target.noMatches') }}
              </p>
            </div>
          </div>

          <button
            type="button"
            class="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors"
            :class="
              mode === 'new'
                ? 'bg-pink-50 ring-1 ring-pink-200 dark:bg-pink-500/10 dark:ring-pink-500/30'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800'
            "
            @click="mode = 'new'"
          >
            <div
              class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors"
              :class="mode === 'new' ? 'border-pink-500 bg-pink-500' : 'border-gray-300 dark:border-gray-600'"
            >
              <UIcon v-if="mode === 'new'" name="i-heroicons-check-20-solid" class="h-3 w-3 text-white" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-gray-900 dark:text-white">{{ t('home.import.target.new') }}</p>
              <p class="text-xs text-gray-400">{{ t('home.import.target.newHint') }}</p>
            </div>
          </button>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton variant="ghost" color="neutral" @click="handleClose">
          {{ t('common.cancel') }}
        </UButton>
        <UButton :disabled="!canConfirm" @click="confirmSelection">
          {{ t('home.import.target.confirm') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
