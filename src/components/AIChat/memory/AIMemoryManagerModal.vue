<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ContactListItem, ContactsResponse } from '@openchatlab/shared-types'
import type { AIMemoryManagementEntry } from '@/services/ai/types'
import { useAIService, useDataService } from '@/services'
import { useToast } from '@/composables/useToast'
import { useSessionStore } from '@/stores/session'

type MemoryView = 'preferences' | 'self' | 'entities'
type EntityScopeType = 'contact' | 'group'

interface MemoryEntityOption {
  scopeType: EntityScopeType
  scopeId: string
  label: string
  detail: string
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'view-source': [payload: { aiChatId: string; messageId: string | null }]
}>()

const { t, locale } = useI18n()
const toast = useToast()
const aiService = useAIService()
const dataService = useDataService()
const sessionStore = useSessionStore()

const activeView = ref<MemoryView>('preferences')
const entries = ref<AIMemoryManagementEntry[]>([])
const contactNames = ref(new Map<string, string>())
const loading = ref(false)
const savingId = ref<string | null>(null)
const editingId = ref<string | null>(null)
const editingContent = ref('')
const creating = ref(false)
const createContent = ref('')
const createEntityType = ref<EntityScopeType>('contact')
const selectedEntity = ref<MemoryEntityOption | null>(null)
const entitySearch = ref('')
const contactOptions = ref<MemoryEntityOption[]>([])
const loadingEntities = ref(false)
let entitySearchTimer: ReturnType<typeof setTimeout> | null = null
let entityPollTimer: ReturnType<typeof setTimeout> | null = null
let entitySearchRequestId = 0
const CONTACT_POLL_INTERVAL_MS = 1500

const viewItems = computed(() => [
  { label: t('ai.global.memory.preferences'), value: 'preferences' },
  { label: t('ai.global.memory.self'), value: 'self' },
  { label: t('ai.global.memory.entities'), value: 'entities' },
])
const visibleEntries = computed(() =>
  entries.value.filter((entry) =>
    activeView.value === 'preferences'
      ? entry.scopeType === 'global'
      : activeView.value === 'self'
        ? entry.scopeType === 'self'
        : entry.scopeType === 'contact' || entry.scopeType === 'group'
  )
)
const entityTypeItems = computed(() => [
  { label: t('ai.global.entityPicker.contacts'), value: 'contact' },
  { label: t('ai.global.entityPicker.groups'), value: 'group' },
])
const groupOptions = computed<MemoryEntityOption[]>(() => {
  const query = entitySearch.value.trim().toLocaleLowerCase()
  return sessionStore.sessions
    .filter((session) => session.type === 'group')
    .filter((session) => !query || `${session.name} ${session.platform}`.toLocaleLowerCase().includes(query))
    .map((session) => ({
      scopeType: 'group',
      scopeId: session.id,
      label: session.name,
      detail: session.platform,
    }))
})
const createEntityOptions = computed(() =>
  createEntityType.value === 'contact' ? contactOptions.value : groupOptions.value
)
const createScopeLabel = computed(() => {
  if (activeView.value === 'preferences') return t('ai.global.memory.preferences')
  if (activeView.value === 'self') return t('ai.global.memory.self')
  return selectedEntity.value?.label ?? t('ai.global.memory.selectEntity')
})
const canCreate = computed(
  () =>
    createContent.value.trim().length > 0 &&
    createContent.value.trim().length <= 2000 &&
    (activeView.value !== 'entities' || selectedEntity.value !== null)
)
function close(): void {
  emit('update:open', false)
}

function startEditing(entry: AIMemoryManagementEntry): void {
  editingId.value = entry.id
  editingContent.value = entry.content
}

function stopEditing(): void {
  editingId.value = null
  editingContent.value = ''
}

function startCreating(): void {
  stopEditing()
  creating.value = true
  createContent.value = ''
  selectedEntity.value = null
  entitySearch.value = ''
  if (activeView.value === 'entities' && createEntityType.value === 'contact') {
    void loadContactOptions('')
  }
}

function stopCreating(): void {
  creating.value = false
  createContent.value = ''
  selectedEntity.value = null
  entitySearch.value = ''
  entitySearchRequestId++
  loadingEntities.value = false
  if (entitySearchTimer) {
    clearTimeout(entitySearchTimer)
    entitySearchTimer = null
  }
  stopContactPolling()
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

function viewSource(entry: AIMemoryManagementEntry): void {
  if (!entry.sourceAIChatId || (entry.sourceStatus !== 'conversation' && entry.sourceStatus !== 'message')) return
  emit('update:open', false)
  emit('view-source', {
    aiChatId: entry.sourceAIChatId,
    messageId: entry.sourceStatus === 'message' ? entry.sourceMessageId : null,
  })
}

function getEntityLabel(entry: AIMemoryManagementEntry): string {
  if (!entry.scopeId) return ''
  if (entry.scopeType === 'contact') return contactNames.value.get(entry.scopeId) ?? entry.scopeId
  return sessionStore.sessions.find((session) => session.id === entry.scopeId)?.name ?? entry.scopeId
}

async function loadContactNames(memories: AIMemoryManagementEntry[]): Promise<void> {
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

async function loadContactOptions(query: string): Promise<void> {
  const requestId = ++entitySearchRequestId
  loadingEntities.value = true
  try {
    const options = {
      acceptStale: true,
      timeRangePreset: 'all',
      page: 1,
      pageSize: 100,
      query: query.trim() || undefined,
    } as const
    const responses = await Promise.all([
      dataService.getContacts({ ...options, pool: 'friend' }),
      dataService.getContacts({ ...options, pool: 'non_friend' }),
    ])
    if (requestId !== entitySearchRequestId) return

    const contactsByKey = new Map<string, ContactListItem>()
    responses.flatMap((response) => response.contacts).forEach((contact) => contactsByKey.set(contact.key, contact))
    contactOptions.value = [...contactsByKey.values()].map((contact) => ({
      scopeType: 'contact',
      scopeId: contact.key,
      label: contact.displayName,
      detail: contact.platformId,
    }))
    scheduleContactPolling(responses, query)
  } catch (error) {
    if (requestId !== entitySearchRequestId) return
    stopContactPolling()
    contactOptions.value = []
    toast.fail(t('ai.global.entityPicker.loadFailed'), { description: String(error) })
  } finally {
    if (requestId === entitySearchRequestId) loadingEntities.value = false
  }
}

function stopContactPolling(): void {
  if (!entityPollTimer) return
  clearTimeout(entityPollTimer)
  entityPollTimer = null
}

function scheduleContactPolling(responses: ContactsResponse[], query: string): void {
  stopContactPolling()
  if (!creating.value || activeView.value !== 'entities' || createEntityType.value !== 'contact') return
  if (!responses.some((response) => response.task?.status === 'running')) return
  entityPollTimer = setTimeout(() => {
    entityPollTimer = null
    void loadContactOptions(query)
  }, CONTACT_POLL_INTERVAL_MS)
}

function scheduleContactSearch(query: string): void {
  if (entitySearchTimer) clearTimeout(entitySearchTimer)
  stopContactPolling()
  entitySearchRequestId++
  entitySearchTimer = setTimeout(() => {
    entitySearchTimer = null
    void loadContactOptions(query)
  }, 200)
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

async function saveEntry(entry: AIMemoryManagementEntry): Promise<void> {
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

async function createEntry(): Promise<void> {
  if (!canCreate.value) return
  savingId.value = 'new'
  try {
    const scope =
      activeView.value === 'preferences'
        ? { scopeType: 'global' as const, scopeId: null }
        : activeView.value === 'self'
          ? { scopeType: 'self' as const, scopeId: null }
          : {
              scopeType: selectedEntity.value!.scopeType,
              scopeId: selectedEntity.value!.scopeId,
            }
    const created = await aiService.createAIMemory({
      ...scope,
      content: createContent.value,
    })
    entries.value = [created, ...entries.value]
    if (created.scopeType === 'contact' && created.scopeId && selectedEntity.value) {
      contactNames.value = new Map(contactNames.value).set(created.scopeId, selectedEntity.value.label)
    }
    stopCreating()
    toast.success(t('ai.global.memory.toast.created'))
  } catch (error) {
    toast.fail(t('ai.global.memory.toast.createFailed'), { description: String(error) })
  } finally {
    savingId.value = null
  }
}

async function deleteEntry(entry: AIMemoryManagementEntry): Promise<void> {
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
    if (activeView.value === 'entities') {
      await Promise.all(currentEntries.map((entry) => aiService.deleteAIMemory(entry.id)))
    } else {
      await aiService.clearAIMemories({
        scopeType: activeView.value === 'preferences' ? 'global' : 'self',
        scopeId: null,
      })
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
    else {
      stopEditing()
      stopCreating()
    }
  },
  { immediate: true }
)

watch(activeView, () => stopCreating())

watch(createEntityType, (scopeType) => {
  stopContactPolling()
  entitySearchRequestId++
  loadingEntities.value = false
  selectedEntity.value = null
  entitySearch.value = ''
  if (creating.value && activeView.value === 'entities' && scopeType === 'contact') void loadContactOptions('')
})

watch(entitySearch, (query) => {
  selectedEntity.value = null
  if (creating.value && activeView.value === 'entities' && createEntityType.value === 'contact') {
    scheduleContactSearch(query)
  }
})

onBeforeUnmount(() => {
  entitySearchRequestId++
  if (entitySearchTimer) clearTimeout(entitySearchTimer)
  stopContactPolling()
})
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
          <div class="mb-3 flex items-center justify-between gap-3">
            <UTabs v-model="activeView" :items="viewItems" :content="false" size="sm" class="min-w-max" />
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-400">
                {{ t('ai.global.memory.count', { count: visibleEntries.length }) }}
              </span>
              <UButton
                icon="i-lucide-plus"
                color="primary"
                variant="soft"
                size="xs"
                :disabled="loading"
                @click="creating ? stopCreating() : startCreating()"
              >
                {{ t('ai.global.memory.add') }}
              </UButton>
            </div>
          </div>

          <div
            v-if="creating"
            class="mb-3 rounded-xl border border-primary-200 bg-primary-50/40 p-3 dark:border-primary-900/70 dark:bg-primary-950/20"
          >
            <div class="mb-2 flex items-center justify-between gap-3">
              <span class="text-xs font-medium text-gray-700 dark:text-gray-200">
                {{ t('ai.global.memory.createTitle') }}
              </span>
              <span class="truncate text-[11px] text-gray-400">
                {{ t('ai.global.memory.scopeLabel', { scope: createScopeLabel }) }}
              </span>
            </div>

            <div v-if="activeView === 'entities'" class="mb-3 space-y-2">
              <UTabs v-model="createEntityType" :items="entityTypeItems" :content="false" size="xs" />
              <UInput
                v-model="entitySearch"
                icon="i-lucide-search"
                size="sm"
                :placeholder="t('ai.global.entityPicker.search')"
              />
              <div
                class="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-1 dark:border-gray-800"
              >
                <div v-if="loadingEntities" class="flex h-20 items-center justify-center">
                  <UIcon name="i-lucide-loader-2" class="h-4 w-4 animate-spin text-gray-400" />
                </div>
                <template v-else>
                  <button
                    v-for="option in createEntityOptions"
                    :key="`${option.scopeType}:${option.scopeId}`"
                    type="button"
                    class="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-xs transition-colors"
                    :class="
                      selectedEntity?.scopeId === option.scopeId && selectedEntity.scopeType === option.scopeType
                        ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-200'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                    "
                    @click="selectedEntity = option"
                  >
                    <span class="truncate">{{ option.label }}</span>
                    <span class="shrink-0 text-[10px] text-gray-400">{{ option.detail }}</span>
                  </button>
                </template>
                <p
                  v-if="!loadingEntities && createEntityOptions.length === 0"
                  class="flex h-20 items-center justify-center text-xs text-gray-400"
                >
                  {{ t('ai.global.entityPicker.empty') }}
                </p>
              </div>
            </div>

            <UTextarea
              v-model="createContent"
              :rows="3"
              :maxlength="2000"
              autoresize
              class="w-full"
              :placeholder="t('ai.global.memory.contentPlaceholder')"
            />
            <div class="mt-2 flex items-center justify-between gap-3">
              <span class="text-[11px] text-gray-400">{{ createContent.trim().length }} / 2000</span>
              <div class="flex items-center gap-2">
                <UButton color="neutral" variant="ghost" size="xs" @click="stopCreating">
                  {{ t('common.cancel') }}
                </UButton>
                <UButton size="xs" :loading="savingId === 'new'" :disabled="!canCreate" @click="createEntry">
                  {{ t('common.save') }}
                </UButton>
              </div>
            </div>
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
                <div
                  v-if="entry.scopeType === 'contact' || entry.scopeType === 'group'"
                  class="mb-2 flex items-center gap-1.5 text-xs text-gray-500"
                >
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
                    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-400">
                      <span>{{ t(`ai.global.memory.source.${entry.sourceType}`) }}</span>
                      <span aria-hidden="true">·</span>
                      <span>{{ t('ai.global.memory.createdAt', { time: formatUpdatedAt(entry.createdAt) }) }}</span>
                      <template v-if="entry.updatedAt !== entry.createdAt">
                        <span aria-hidden="true">·</span>
                        <span>{{ t('ai.global.memory.updatedAt', { time: formatUpdatedAt(entry.updatedAt) }) }}</span>
                      </template>
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
                  <div
                    v-if="entry.sourceType === 'ai' || entry.sourceStatus !== 'none'"
                    class="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-2 text-[11px] dark:border-gray-800"
                  >
                    <span v-if="entry.sourceType === 'ai'" class="text-amber-600 dark:text-amber-400">
                      {{ t('ai.global.memory.aiSourceWarning') }}
                    </span>
                    <span v-if="entry.sourceStatus === 'unavailable'" class="ml-auto text-gray-400 dark:text-gray-500">
                      {{ t('ai.global.memory.sourceUnavailable') }}
                    </span>
                    <UButton
                      v-else-if="entry.sourceStatus === 'conversation' || entry.sourceStatus === 'message'"
                      class="ml-auto"
                      icon="i-lucide-external-link"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      @click="viewSource(entry)"
                    >
                      {{ t('ai.global.memory.viewSource') }}
                    </UButton>
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
