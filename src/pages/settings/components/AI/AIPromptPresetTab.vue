<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@nuxt/ui/runtime/composables/useToast.js'

interface LegacyPromptStoreData {
  customPromptPresets?: Array<{
    id?: string
    name?: string
    systemPrompt?: string
    applicableTo?: 'common' | 'group' | 'private'
  }>
  builtinPresetOverrides?: Record<string, { name?: string; systemPrompt?: string }>
  fetchedRemotePresetIds?: string[]
  aiPromptSettings?: { activePresetId?: string }
  activeGroupPresetId?: string
  activePrivatePresetId?: string
}

const { t } = useI18n()
const toast = useToast()

const rawPromptStore = ref<LegacyPromptStoreData | null>(null)
const rawPromptText = ref('')
const parseError = ref('')

/**
 * 旧版提示词已经不再参与运行，这里只保留原始数据查看与复制能力。
 */
function loadLegacyPromptStore() {
  const raw = localStorage.getItem('prompt')
  rawPromptText.value = raw || ''
  parseError.value = ''
  rawPromptStore.value = null

  if (!raw) return

  try {
    rawPromptStore.value = JSON.parse(raw) as LegacyPromptStoreData
  } catch (error) {
    parseError.value = String(error)
  }
}

const hasLegacyPromptStore = computed(() => rawPromptText.value.trim().length > 0)

const customPromptPresets = computed(() => {
  return Array.isArray(rawPromptStore.value?.customPromptPresets) ? rawPromptStore.value!.customPromptPresets : []
})

const remotePresetIds = computed(() => {
  return Array.isArray(rawPromptStore.value?.fetchedRemotePresetIds) ? rawPromptStore.value!.fetchedRemotePresetIds : []
})

const activePresetId = computed(() => {
  const settings = rawPromptStore.value?.aiPromptSettings
  return (
    settings?.activePresetId ||
    rawPromptStore.value?.activeGroupPresetId ||
    rawPromptStore.value?.activePrivatePresetId ||
    ''
  )
})

const formattedPromptStoreJson = computed(() => {
  if (!rawPromptText.value) return ''
  if (!rawPromptStore.value) return rawPromptText.value
  return JSON.stringify(rawPromptStore.value, null, 2)
})

function getApplicableLabel(applicableTo?: 'common' | 'group' | 'private'): string {
  if (applicableTo === 'group') return t('settings.aiPrompt.legacyPrompt.groupOnly')
  if (applicableTo === 'private') return t('settings.aiPrompt.legacyPrompt.privateOnly')
  return t('settings.aiPrompt.legacyPrompt.common')
}

async function handleCopyJson() {
  if (!formattedPromptStoreJson.value) return

  try {
    await navigator.clipboard.writeText(formattedPromptStoreJson.value)
    toast.add({
      title: t('settings.aiPrompt.legacyPrompt.copySuccess'),
      color: 'primary',
      icon: 'i-heroicons-clipboard-document-check',
      duration: 2000,
    })
  } catch (error) {
    toast.add({
      title: t('settings.aiPrompt.legacyPrompt.copyFailed'),
      description: String(error),
      color: 'error',
      icon: 'i-heroicons-x-circle',
      duration: 3000,
    })
  }
}

onMounted(() => {
  loadLegacyPromptStore()
})
</script>

<template>
  <div class="space-y-6">
    <div class="rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
      <div class="flex items-start gap-3">
        <div
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300"
        >
          <UIcon name="i-heroicons-archive-box" class="h-4.5 w-4.5" />
        </div>
        <div class="min-w-0">
          <h4 class="text-sm font-semibold text-amber-900 dark:text-amber-100">
            {{ t('settings.aiPrompt.legacyPrompt.title') }}
          </h4>
          <p class="mt-1 text-sm leading-6 text-amber-800 dark:text-amber-200">
            {{ t('settings.aiPrompt.legacyPrompt.description') }}
          </p>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <UButton color="primary" size="xs" :disabled="!hasLegacyPromptStore" @click="handleCopyJson">
        <UIcon name="i-heroicons-document-duplicate" class="mr-1 h-3.5 w-3.5" />
        {{ t('settings.aiPrompt.legacyPrompt.copyJson') }}
      </UButton>
    </div>

    <div
      v-if="!hasLegacyPromptStore"
      class="rounded-xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-700 dark:bg-gray-800/50"
    >
      <p class="text-sm font-medium text-gray-700 dark:text-gray-200">
        {{ t('settings.aiPrompt.legacyPrompt.emptyTitle') }}
      </p>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {{ t('settings.aiPrompt.legacyPrompt.emptyDescription') }}
      </p>
    </div>

    <template v-else>
      <!-- 这里只保留最必要的旧数据摘要，避免遗留信息继续分散注意力。 -->
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div class="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('settings.aiPrompt.legacyPrompt.activePreset') }}</p>
          <p class="mt-2 text-sm font-medium text-gray-900 dark:text-white">
            {{ activePresetId || t('settings.aiPrompt.legacyPrompt.notConfigured') }}
          </p>
        </div>
        <div class="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ t('settings.aiPrompt.legacyPrompt.customPresetCount') }}
          </p>
          <p class="mt-2 text-sm font-medium text-gray-900 dark:text-white">{{ customPromptPresets.length }}</p>
        </div>
        <div class="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ t('settings.aiPrompt.legacyPrompt.remotePresetCount') }}
          </p>
          <p class="mt-2 text-sm font-medium text-gray-900 dark:text-white">{{ remotePresetIds.length }}</p>
        </div>
      </div>

      <div
        v-if="parseError"
        class="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/20"
      >
        <p class="text-sm font-medium text-red-700 dark:text-red-300">
          {{ t('settings.aiPrompt.legacyPrompt.parseError') }}
        </p>
        <p class="mt-1 break-all text-xs text-red-600 dark:text-red-400">{{ parseError }}</p>
      </div>

      <div v-if="customPromptPresets.length > 0" class="space-y-3">
        <h4 class="text-sm font-semibold text-gray-900 dark:text-white">
          {{ t('settings.aiPrompt.legacyPrompt.customPresetList') }}
        </h4>
        <div class="space-y-2">
          <div
            v-for="preset in customPromptPresets"
            :key="preset.id || preset.name || preset.systemPrompt"
            class="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
          >
            <div class="flex items-center gap-2">
              <p class="text-sm font-medium text-gray-900 dark:text-white">{{ preset.name || '-' }}</p>
              <UBadge color="gray" variant="soft" size="xs">
                {{ getApplicableLabel(preset.applicableTo) }}
              </UBadge>
            </div>
            <p class="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-6 text-gray-500 dark:text-gray-400">
              {{ preset.systemPrompt || t('settings.aiPrompt.legacyPrompt.noPromptContent') }}
            </p>
          </div>
        </div>
      </div>

      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h4 class="text-sm font-semibold text-gray-900 dark:text-white">
            {{ t('settings.aiPrompt.legacyPrompt.rawJsonTitle') }}
          </h4>
          <span class="text-xs text-gray-400 dark:text-gray-500">
            {{ t('settings.aiPrompt.legacyPrompt.rawJsonHint') }}
          </span>
        </div>
        <div class="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/70">
          <pre
            class="max-h-[360px] overflow-auto whitespace-pre-wrap break-all text-xs leading-6 text-gray-600 dark:text-gray-300"
            >{{ formattedPromptStoreJson }}</pre
          >
        </div>
      </div>
    </template>
  </div>
</template>
