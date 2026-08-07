<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { PageTabs } from '@/components/navigation'

export interface SettingsDialogTab {
  id: string
  label: string
  icon?: string
}

const props = defineProps<{
  open: boolean
  activeTab: string
  tabs: SettingsDialogTab[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:activeTab': [value: string]
}>()

const { t } = useI18n()
const currentTab = computed({
  get: () => props.activeTab,
  set: (value: string) => emit('update:activeTab', value),
})
</script>

<template>
  <UModal
    :open="open"
    :ui="{
      content: 'w-full sm:max-w-[900px] z-[100]',
      overlay: 'z-[99] bg-gray-200/80 backdrop-blur-sm dark:bg-page-dark/80',
    }"
    @update:open="emit('update:open', $event)"
  >
    <template #content>
      <div class="flex h-[100dvh] min-h-0 flex-col overflow-hidden sm:h-[85vh] sm:min-h-[650px]">
        <div class="shrink-0 border-b border-gray-200 px-4 pt-4 sm:px-6 sm:pt-5 dark:border-gray-800">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 dark:bg-primary-500">
                <UIcon name="i-heroicons-cog-6-tooth" class="h-4 w-4 text-white" />
              </div>
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
                {{ t('settings.title') }}
              </h2>
            </div>
            <UButton
              icon="i-heroicons-x-mark"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-label="t('common.close')"
              @click="emit('update:open', false)"
            />
          </div>
          <PageTabs v-model="currentTab" class="mt-4 pb-3" :items="tabs" />
        </div>

        <div class="relative flex-1">
          <div class="absolute inset-0 overflow-y-auto p-4 sm:p-6">
            <slot />
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
