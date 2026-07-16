<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  open: boolean
  backupName: string
  upgrading: boolean
  skipping: boolean
}>()

const emit = defineEmits<{
  skip: []
  confirm: []
}>()

const { t } = useI18n()
</script>

<template>
  <UModal :open="open" :dismissible="false" :ui="{ content: 'sm:max-w-md z-50', overlay: 'z-40' }">
    <template #content>
      <div class="p-5">
        <div class="flex items-start gap-3">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-400"
          >
            <UIcon name="i-lucide-sparkles" class="h-5 w-5" />
          </div>
          <div class="min-w-0">
            <h3 class="font-semibold text-gray-900 dark:text-white">
              {{ t('ai.assistant.upgrade.title') }}
            </h3>
            <p class="mt-1.5 text-sm leading-6 text-gray-600 dark:text-gray-400">
              {{ t('ai.assistant.upgrade.message', { backupName }) }}
            </p>
          </div>
        </div>

        <div class="mt-4 rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/70">
          <div class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <UIcon name="i-lucide-copy-check" class="h-4 w-4 shrink-0 text-gray-400" />
            <span class="truncate">{{ backupName }}</span>
          </div>
        </div>
        <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {{ t('ai.assistant.upgrade.skipHint') }}
        </p>

        <div class="mt-5 flex justify-end gap-2">
          <UButton variant="soft" :loading="skipping" :disabled="upgrading" @click="emit('skip')">
            {{ t('ai.assistant.upgrade.skip') }}
          </UButton>
          <UButton color="primary" :loading="upgrading" :disabled="skipping" @click="emit('confirm')">
            {{ t('ai.assistant.upgrade.confirm') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
