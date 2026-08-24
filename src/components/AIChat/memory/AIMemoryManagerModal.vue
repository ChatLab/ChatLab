<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { AIMemoryEntry } from '@/services/ai/types'
import { useAIService, useDataService } from '@/services'
import { useToast } from '@/composables/useToast'
import { usePromptStore } from '@/stores/prompt'
import { useSessionStore } from '@/stores/session'

type MemoryView = 'preferences' | 'entities'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { t, locale } = useI18n()
const toast = useToast()
const aiService = useAIService()
const dataService = useDataService()
const promptStore = usePromptStore()
const sessionStore = useSessionStore()
const { aiGlobalSettings } = storeToRefs(promptStore)

const activeView = ref<MemoryView>('preferences')
const entries = ref<AIMemoryEntry[]>([])
const contactNames = ref(new Map<string, string>())
const loading = ref(false)
const savingId = ref<string | null>(null)
const editingId = ref<string | null>(null)
const editingContent = ref('')

const viewItems = computed(() => [
  { label: t('ai.global.memory.preferences'), value: 'preferences' },
  { label: t('ai.global.memory.entities'), value: 'entities' },
])
const visibleEntries = computed(() =>
  entries.value.filter((entry) =>
    activeView.value === 'preferences' ? entry.scopeType === 'global' : entry.scopeType !== 'global'
  )
)
const proactiveMemory = computed({
  get: () => aiGlobalSettings.value.allowProactiveMemory ?? true,
  set: (value: boolean) => promptStore.updateAIGlobalSettings({ allowProactiveMemory: value }),
})

function close(): void {
  emit('update:open', false)
}

function startEditing(entry: AIMemoryEntry): void {
  editingId.value = entry.id
  editingContent.value = entry.content
}

function stopEditing(): void {
  editingId.value = null
  editingContent.value = ''
}

function formatUpdatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function getEntityLabel(entry: AIMemoryEntry): string {
  if (!entry.scopeId) return ''
  if (entry.scopeType === 'contact') return contactNames.value.get(entry.scopeId) ?? entry.scopeId
  return sessionStore.sessions.find((session) => session.id === entry.scopeId)?.name ?? entry.scopeId
}

async function loadContactNames(memories: AIMemoryEntry[]): Promise<void> {
  const keys = [
    ...new Set(memories.filter((entry) => entry.scopeType === 'contact').map((entry) => entry.scopeId)),
  ].filter((key): key is string => Boolean(key))
  const names = new Map<string, string>()
  const results = await Promise.allSettled(
    keys.map(async (key) => ({ key, detail: await dataService.getContactDetail(key, { acceptStale: true }) }))
  )
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.detail.contact) {
      names.set(result.value.key, result.value.detail.contact.displayName)
    }
  }
  contactNames.value = names
}

async function loadMemories(): Promise<void> {
  loading.value = true
  try {
    const memories = await aiService.getAIMemories()
    entries.value = memories
    await Promise.all([sessionStore.loadSessions(), loadContactNames(memories)])
  } catch (error) {
    toast.fail(t('ai.global.memory.toast.loadFailed'), { description: String(error) })
  } finally {
    loading.value = false
  }
}

async function saveEntry(entry: AIMemoryEntry): Promise<void> {
  if (!editingContent.value.trim()) return
  savingId.value = entry.id
  try {
    const updated = await aiService.updateAIMemory(entry.id, editingContent.value)
    entries.value = entries.value.map((item) => (item.id === updated.id ? updated : item))
    stopEditing()
    toast.success(t('ai.global.memory.toast.saved'))
  } catch (error) {
    toast.fail(t('ai.global.memory.toast.saveFailed'), { description: String(error) })
  } finally {
    savingId.value = null
  }
}

async function deleteEntry(entry: AIMemoryEntry): Promise<void> {
  if (!confirm(t('ai.global.memory.confirmDelete'))) return
  savingId.value = entry.id
  try {
    await aiService.deleteAIMemory(entry.id)
    entries.value = entries.value.filter((item) => item.id !== entry.id)
    if (editingId.value === entry.id) stopEditing()
    toast.success(t('ai.global.memory.toast.deleted'))
  } catch (error) {
    toast.fail(t('ai.global.memory.toast.deleteFailed'), { description: String(error) })
  } finally {
    savingId.value = null
  }
}

async function clearCurrentView(): Promise<void> {
  const currentEntries = visibleEntries.value
  if (currentEntries.length === 0 || !confirm(t('ai.global.memory.confirmClearView'))) return
  loading.value = true
  try {
    if (activeView.value === 'preferences') {
      await aiService.clearAIMemories({ scopeType: 'global', scopeId: null })
    } else {
      await Promise.all(currentEntries.map((entry) => aiService.deleteAIMemory(entry.id)))
    }
    await loadMemories()
    toast.success(t('ai.global.memory.toast.cleared'))
  } catch (error) {
    await loadMemories()
    toast.fail(t('ai.global.memory.toast.clearFailed'), { description: String(error) })
  } finally {
    loading.value = false
  }
}

async function clearAll(): Promise<void> {
  if (entries.value.length === 0 || !confirm(t('ai.global.memory.confirmClearAll'))) return
  loading.value = true
  try {
    await aiService.clearAIMemories({ all: true })
    entries.value = []
    contactNames.value = new Map()
    stopEditing()
    toast.success(t('ai.global.memory.toast.cleared'))
  } catch (error) {
    toast.fail(t('ai.global.memory.toast.clearFailed'), { description: String(error) })
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void loadMemories()
    else stopEditing()
  },
  { immediate: true }
)
</script>

<template>
  <UModal :open="open" :ui="{ content: 'sm:max-w-2xl' }" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="flex max-h-[78vh] min-h-[520px] flex-col overflow-hidden">
        <header class="flex items-start justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div>
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('ai.global.memory.title') }}</h2>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('ai.global.memory.description') }}</p>
          </div>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="t('common.close')"
            @click="close"
          />
        </header>

        <div class="flex min-h-0 flex-1 flex-col px-5 py-4">
          <div class="mb-4 flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-900/60">
            <div class="min-w-0 pr-4">
              <p class="text-sm text-gray-900 dark:text-gray-100">{{ t('ai.global.memory.proactive.title') }}</p>
              <p class="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {{ t('ai.global.memory.proactive.description') }}
              </p>
            </div>
            <USwitch v-model="proactiveMemory" />
          </div>

          <div class="mb-3 flex items-center justify-between gap-3">
            <UTabs v-model="activeView" :items="viewItems" :content="false" size="sm" class="min-w-max" />
            <span class="text-xs text-gray-400">
              {{ t('ai.global.memory.count', { count: visibleEntries.length }) }}
            </span>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto pr-1">
            <div v-if="loading" class="flex h-full min-h-56 items-center justify-center">
              <UIcon name="i-lucide-loader-2" class="h-5 w-5 animate-spin text-gray-400" />
            </div>
            <div
              v-else-if="visibleEntries.length === 0"
              class="flex min-h-56 flex-col items-center justify-center text-center"
            >
              <UIcon name="i-lucide-brain" class="mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" />
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('ai.global.memory.empty') }}</p>
            </div>
            <div v-else class="space-y-2">
              <article
                v-for="entry in visibleEntries"
                :key="entry.id"
                class="rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-800"
              >
                <div v-if="entry.scopeType !== 'global'" class="mb-2 flex items-center gap-1.5 text-xs text-gray-500">
                  <UIcon
                    :name="entry.scopeType === 'contact' ? 'i-lucide-user-round' : 'i-lucide-users-round'"
                    class="h-3.5 w-3.5"
                  />
                  <span class="truncate">{{ getEntityLabel(entry) }}</span>
                </div>

                <div v-if="editingId === entry.id">
                  <UTextarea v-model="editingContent" :rows="3" autoresize class="w-full" />
                  <div class="mt-2 flex justify-end gap-2">
                    <UButton color="neutral" variant="ghost" size="xs" @click="stopEditing">
                      {{ t('common.cancel') }}
                    </UButton>
                    <UButton
                      size="xs"
                      :loading="savingId === entry.id"
                      :disabled="!editingContent.trim()"
                      @click="saveEntry(entry)"
                    >
                      {{ t('common.save') }}
                    </UButton>
                  </div>
                </div>
                <template v-else>
                  <p class="whitespace-pre-wrap break-words text-sm leading-6 text-gray-800 dark:text-gray-200">
                    {{ entry.content }}
                  </p>
                  <div class="mt-2 flex items-center justify-between gap-3">
                    <div class="flex min-w-0 items-center gap-2 text-[11px] text-gray-400">
                      <span>{{ t(`ai.global.memory.source.${entry.sourceType}`) }}</span>
                      <span aria-hidden="true">·</span>
                      <span class="truncate">{{ formatUpdatedAt(entry.updatedAt) }}</span>
                    </div>
                    <div class="flex shrink-0 items-center gap-0.5">
                      <UButton
                        icon="i-lucide-pencil"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        :aria-label="t('common.edit')"
                        @click="startEditing(entry)"
                      />
                      <UButton
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="ghost"
                        size="xs"
                        :loading="savingId === entry.id"
                        :aria-label="t('common.delete')"
                        @click="deleteEntry(entry)"
                      />
                    </div>
                  </div>
                </template>
              </article>
            </div>
          </div>
        </div>

        <footer class="flex items-center justify-between border-t border-gray-200 px-5 py-3 dark:border-gray-800">
          <UButton
            color="error"
            variant="ghost"
            size="sm"
            :disabled="visibleEntries.length === 0 || loading"
            @click="clearCurrentView"
          >
            {{ t('ai.global.memory.clearCurrent') }}
          </UButton>
          <div class="flex items-center gap-2">
            <UButton
              color="error"
              variant="soft"
              size="sm"
              :disabled="entries.length === 0 || loading"
              @click="clearAll"
            >
              {{ t('ai.global.memory.clearAll') }}
            </UButton>
            <UButton color="neutral" variant="outline" size="sm" @click="close">{{ t('common.close') }}</UButton>
          </div>
        </footer>
      </div>
    </template>
  </UModal>
</template>
