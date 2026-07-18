<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCacheService } from '@/services/cache/service'
import type { DataDirCleanupInfo } from '@/services/cache/types'
import { useLayoutStore } from '@/stores/layout'

const { t } = useI18n()
const layoutStore = useLayoutStore()
const cleanup = ref<DataDirCleanupInfo | null>(null)
const open = ref(false)

onMounted(async () => {
  try {
    const info = await useCacheService().getDataDir()
    cleanup.value = (info.pendingCleanups ?? []).find((entry) => entry.exists && !entry.noticeDismissed) ?? null
    open.value = Boolean(cleanup.value)
  } catch (error) {
    console.error('Failed to load pending data directory cleanup notice:', error)
  }
})

async function acknowledge(openStorage: boolean) {
  const current = cleanup.value
  open.value = false
  if (current) {
    try {
      await useCacheService().dismissDataDirCleanupNotice(current.id)
    } catch (error) {
      console.error('Failed to dismiss pending data directory cleanup notice:', error)
    }
  }
  if (openStorage) layoutStore.openSettings('storage')
}
</script>

<template>
  <UModal v-model:open="open" :dismissible="false" :ui="{ content: 'sm:max-w-[520px] z-[102]', overlay: 'z-[101]' }">
    <template #content>
      <div class="p-5">
        <div class="flex items-start gap-3">
          <div
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-400"
          >
            <UIcon name="i-heroicons-archive-box" class="h-5 w-5" />
          </div>
          <div class="min-w-0 flex-1">
            <h3 class="text-base font-semibold text-gray-900 dark:text-white">
              {{ t('settings.storage.dataLocation.cleanupNoticeTitle') }}
            </h3>
            <p class="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">
              {{ t('settings.storage.dataLocation.cleanupNoticeDescription') }}
            </p>
          </div>
        </div>

        <div v-if="cleanup" class="mt-4 rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/60">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ t('settings.storage.dataLocation.cleanupOldPath') }}
          </p>
          <p class="mt-1 truncate font-mono text-xs text-gray-700 dark:text-gray-300" :title="cleanup.sourceDir">
            {{ cleanup.sourceDir }}
          </p>
        </div>

        <div class="mt-5 flex justify-end gap-2">
          <UButton variant="ghost" @click="acknowledge(false)">
            {{ t('settings.storage.dataLocation.cleanupLater') }}
          </UButton>
          <UButton color="primary" @click="acknowledge(true)">
            {{ t('settings.storage.dataLocation.cleanupGoToStorage') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
