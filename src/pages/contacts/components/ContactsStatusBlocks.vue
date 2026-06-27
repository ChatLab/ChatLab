<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ContactsCacheStatus } from '@openchatlab/shared-types'

defineProps<{
  showDisabledNotice: boolean
  activePrivateSessionCount: number
  cacheStatus?: ContactsCacheStatus
  taskFailed: boolean
  taskLastError?: string
  isTaskRunning: boolean
  isRecomputing: boolean
}>()

const emit = defineEmits<{
  recompute: []
}>()

const { t } = useI18n()
</script>

<template>
  <div
    v-if="showDisabledNotice"
    class="flex items-center gap-3.5 rounded-2xl border border-amber-200/60 bg-amber-50/40 p-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/10 dark:text-amber-200 backdrop-blur-sm shadow-sm"
  >
    <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100/80 dark:bg-amber-950/50">
      <UIcon name="i-lucide-alert-triangle" class="h-5 w-5 text-amber-500" />
    </div>
    <span class="font-medium">
      {{ t('contacts.disabled', { count: activePrivateSessionCount }) }}
    </span>
  </div>

  <div
    v-if="cacheStatus === 'stale' && !isTaskRunning"
    class="flex flex-col gap-4 rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-4 text-sm text-zinc-700 dark:border-zinc-800/80 dark:bg-zinc-900/40 dark:text-zinc-300 sm:flex-row sm:items-center sm:justify-between backdrop-blur-sm shadow-sm"
  >
    <div class="flex items-center gap-3.5">
      <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800/80">
        <UIcon name="i-lucide-history" class="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
      </div>
      <span class="font-medium">
        {{ t('contacts.stale.inline') }}
      </span>
    </div>
    <div class="flex items-center shrink-0 self-end sm:self-center">
      <UButton
        size="sm"
        color="primary"
        variant="soft"
        class="rounded-xl px-4 font-medium"
        :loading="isRecomputing || isTaskRunning"
        :disabled="isTaskRunning"
        @click="emit('recompute')"
      >
        {{ t('contacts.actions.recompute') }}
      </UButton>
    </div>
  </div>

  <div
    v-if="taskFailed"
    class="flex flex-col gap-4 rounded-2xl border border-red-200/60 bg-red-50/40 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/10 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between backdrop-blur-sm shadow-sm"
  >
    <div class="flex min-w-0 items-center gap-3.5">
      <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-100/80 dark:bg-red-950/50">
        <UIcon name="i-lucide-alert-circle" class="h-5 w-5 text-red-500" />
      </div>
      <span class="truncate font-medium">{{ taskLastError || t('contacts.task.failed') }}</span>
    </div>
    <div class="flex items-center shrink-0 self-end sm:self-center">
      <UButton size="sm" color="error" variant="soft" class="rounded-xl px-4 font-medium" @click="emit('recompute')">
        {{ t('contacts.task.retry') }}
      </UButton>
    </div>
  </div>
</template>
