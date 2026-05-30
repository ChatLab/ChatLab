<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '@/stores/session'
import { useSettingsStore } from '@/stores/settings'
import { getChatlabSiteLocalePath } from '@/utils/chatlabSiteLocale'
import { useDataService, useImportService, useSessionIndexService } from '@/services'
import { getSessionGapThreshold } from '@/composables/useUiConfig'

const { t } = useI18n()
const router = useRouter()
const sessionStore = useSessionStore()
const settingsStore = useSettingsStore()

const isImporting = ref(false)
const stage = ref<'downloading' | 'importing'>('downloading')
const error = ref<string | null>(null)

async function navigateToSession(sessionId: string) {
  const session = await useDataService().getSession(sessionId)
  if (session) {
    const routeName = session.type === 'private' ? 'private-chat' : 'group-chat'
    router.push({ name: routeName, params: { id: sessionId } })
  }
}

async function handleImportViaService() {
  const demoLocale = getChatlabSiteLocalePath(settingsStore.locale) || 'en'
  return useImportService().importDemo(demoLocale, (progress) => {
    stage.value = progress.stage
  })
}

async function handleImport() {
  isImporting.value = true
  error.value = null
  stage.value = 'downloading'

  try {
    const result = await handleImportViaService()

    if (result.success && result.groupSessionId) {
      await sessionStore.loadSessions()
      sessionStore.selectSession(result.groupSessionId)

      try {
        const gapThreshold = getSessionGapThreshold()
        const sessionIndexService = useSessionIndexService()
        await sessionIndexService.generate(result.groupSessionId, gapThreshold)
        if (result.privateSessionIds?.length) {
          await Promise.all(result.privateSessionIds.map((id) => sessionIndexService.generate(id, gapThreshold)))
        }
      } catch (e) {
        console.error('自动生成会话索引失败:', e)
      }

      await navigateToSession(result.groupSessionId)
    } else {
      error.value = result.error || t('home.demo.failed')
    }
  } catch (e) {
    error.value = String(e)
  } finally {
    isImporting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col items-center gap-2">
    <UButton
      :trailing-icon="isImporting ? undefined : 'i-heroicons-chevron-right-20-solid'"
      :loading="isImporting"
      :disabled="isImporting"
      @click="handleImport"
    >
      {{
        isImporting
          ? stage === 'downloading'
            ? t('home.demo.downloading')
            : t('home.demo.importing')
          : t('home.demo.viewExample')
      }}
    </UButton>

    <p v-if="error" class="text-xs text-red-500 dark:text-red-400">
      {{ error }}
    </p>
  </div>
</template>
