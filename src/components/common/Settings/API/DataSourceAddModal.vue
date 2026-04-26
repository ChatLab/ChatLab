<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiServerStore, type DataSource, type RemoteSession } from '@/stores/apiServer'
import { getSessionTypeSelection, type SessionTypeSelection } from './sessionDiscovery'

const props = defineProps<{
  open: boolean
  manageSource?: DataSource
  subscribedRemoteIds?: Set<string>
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  sourceAdded: []
  sessionsAdded: [sourceId: string, sessions: Array<{ name: string; remoteSessionId: string }>]
}>()

const { t } = useI18n()
const store = useApiServerStore()

const isManageMode = computed(() => !!props.manageSource)

const formData = ref({
  name: '',
  baseUrl: '',
  token: '',
  intervalMinutes: 60,
})

const remoteSessions = ref<RemoteSession[]>([])
const selectedSessionIds = ref<Set<string>>(new Set())
const discovering = ref(false)
const loadingMore = ref(false)
const discoveryError = ref('')
const discoveryKeyword = ref('')
const discoveryNextCursor = ref<string | undefined>()
const discoveryHasMore = ref(false)
const hasDiscoveryRun = ref(false)

type SessionTypeFilter = 'all' | SessionTypeSelection

const activeSessionTypeFilter = ref<SessionTypeFilter>('all')
const discoveryPageSize = 100

watch(
  () => props.open,
  async (val) => {
    if (val) {
      if (isManageMode.value && props.manageSource) {
        formData.value = {
          name: props.manageSource.name || '',
          baseUrl: props.manageSource.baseUrl,
          token: props.manageSource.token,
          intervalMinutes: props.manageSource.intervalMinutes,
        }
      } else {
        formData.value = { name: '', baseUrl: '', token: '', intervalMinutes: 60 }
      }
      remoteSessions.value = []
      selectedSessionIds.value = new Set()
      discoveryError.value = ''
      discoveryKeyword.value = ''
      discoveryNextCursor.value = undefined
      discoveryHasMore.value = false
      hasDiscoveryRun.value = false
      activeSessionTypeFilter.value = 'all'
      if (isManageMode.value) {
        await discoverSessions()
      }
    }
  },
  { immediate: true }
)

const visibleRemoteSessions = computed(() => {
  if (activeSessionTypeFilter.value === 'all') return remoteSessions.value
  return remoteSessions.value.filter((session) => getSessionTypeSelection(session) === activeSessionTypeFilter.value)
})

const visibleAvailableSessions = computed(() =>
  visibleRemoteSessions.value.filter((s) => !props.subscribedRemoteIds?.has(s.id))
)

const allSelected = computed(
  () =>
    visibleAvailableSessions.value.length > 0 &&
    visibleAvailableSessions.value.every((session) => selectedSessionIds.value.has(session.id))
)

const sessionTypeSelectionOptions = computed(() =>
  (
    [
      { value: 'all', label: t('settings.api.dataSources.discovery.typeAll') },
      { value: 'private', label: t('settings.api.dataSources.discovery.typePrivate') },
      { value: 'group', label: t('settings.api.dataSources.discovery.typeGroup') },
      { value: 'other', label: t('settings.api.dataSources.discovery.typeOther') },
    ] as Array<{ value: SessionTypeFilter; label: string }>
  ).map((option) => ({
    ...option,
    count:
      option.value === 'all'
        ? remoteSessions.value.length
        : remoteSessions.value.filter((session) => getSessionTypeSelection(session) === option.value).length,
  }))
)

function setSessionTypeFilter(type: SessionTypeFilter) {
  activeSessionTypeFilter.value = type
}

function toggleSelectAll() {
  const visibleIds = visibleAvailableSessions.value.map((s) => s.id)
  if (allSelected.value) {
    const next = new Set(selectedSessionIds.value)
    for (const id of visibleIds) next.delete(id)
    selectedSessionIds.value = next
  } else {
    selectedSessionIds.value = new Set([...selectedSessionIds.value, ...visibleIds])
  }
}

function toggleSession(id: string) {
  if (props.subscribedRemoteIds?.has(id)) return
  const next = new Set(selectedSessionIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedSessionIds.value = next
}

function closeModal() {
  emit('update:open', false)
}

async function discoverSessions() {
  await fetchDiscoveryPage({ append: false, resetSelection: true })
}

async function searchSessions() {
  await fetchDiscoveryPage({ append: false, resetSelection: true })
}

async function loadMoreSessions() {
  if (!discoveryHasMore.value || !discoveryNextCursor.value) return
  await fetchDiscoveryPage({ append: true, resetSelection: false })
}

function mergeRemoteSessions(current: RemoteSession[], next: RemoteSession[]): RemoteSession[] {
  const merged = new Map(current.map((session) => [session.id, session]))
  for (const session of next) {
    merged.set(session.id, session)
  }
  return [...merged.values()]
}

// 发现请求支持分页；首次查询重置列表，后续由“加载更多”追加。
async function fetchDiscoveryPage(options: { append: boolean; resetSelection: boolean }) {
  if (!formData.value.baseUrl) return

  if (options.append) loadingMore.value = true
  else discovering.value = true

  hasDiscoveryRun.value = true
  discoveryError.value = ''

  if (!options.append) {
    remoteSessions.value = []
    discoveryNextCursor.value = undefined
    discoveryHasMore.value = false
    activeSessionTypeFilter.value = 'all'
    if (options.resetSelection) {
      selectedSessionIds.value = new Set()
    }
  }

  try {
    const result = await store.fetchRemoteSessions(formData.value.baseUrl, formData.value.token, {
      keyword: discoveryKeyword.value.trim() || undefined,
      limit: discoveryPageSize,
      cursor: options.append ? discoveryNextCursor.value : undefined,
    })

    remoteSessions.value = options.append ? mergeRemoteSessions(remoteSessions.value, result.sessions) : result.sessions
    discoveryHasMore.value = Boolean(result.page?.hasMore)
    discoveryNextCursor.value = result.page?.nextCursor
  } catch (err: any) {
    discoveryError.value = err.message || t('settings.api.dataSources.discovery.error')
  } finally {
    discovering.value = false
    loadingMore.value = false
  }
}

async function handleSubmit() {
  if (isManageMode.value) {
    if (selectedSessionIds.value.size === 0 || !props.manageSource) return
    const sessions = remoteSessions.value
      .filter((s) => selectedSessionIds.value.has(s.id))
      .map((s) => ({ name: s.name, remoteSessionId: s.id }))
    emit('sessionsAdded', props.manageSource.id, sessions)
    closeModal()
  } else {
    const ds = await store.addDataSource({
      name: formData.value.name || undefined,
      baseUrl: formData.value.baseUrl,
      token: formData.value.token,
      intervalMinutes: formData.value.intervalMinutes,
    })
    if (ds && selectedSessionIds.value.size > 0) {
      const sessions = remoteSessions.value
        .filter((s) => selectedSessionIds.value.has(s.id))
        .map((s) => ({ name: s.name, remoteSessionId: s.id }))
      await store.addImportSessions(ds.id, sessions)
    }
    emit('sourceAdded')
    closeModal()
  }
}

function formatMessageCount(count?: number): string {
  if (count === undefined) return '-'
  if (count >= 10000) return `${(count / 10000).toFixed(1)}w`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}
</script>

<template>
  <UModal :open="open" :ui="{ content: 'z-[101]', overlay: 'z-[100]' }" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="p-6" style="min-width: 480px; max-height: 80vh; overflow-y: auto">
        <h3 class="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          {{
            isManageMode
              ? t('settings.api.dataSources.edit.manageSessions')
              : t('settings.api.dataSources.form.modalTitle')
          }}
        </h3>

        <div class="space-y-4">
          <!-- New data source: show all fields -->
          <template v-if="!isManageMode">
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.api.dataSources.form.name') }}
              </label>
              <UInput
                v-model="formData.name"
                class="w-full"
                :placeholder="t('settings.api.dataSources.form.namePlaceholder')"
              />
            </div>

            <div>
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.api.dataSources.discovery.baseUrl') }}
              </label>
              <UInput
                v-model="formData.baseUrl"
                class="w-full"
                :placeholder="t('settings.api.dataSources.discovery.baseUrlPlaceholder')"
              />
            </div>

            <div>
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.api.dataSources.form.token') }}
              </label>
              <UInput
                v-model="formData.token"
                class="w-full"
                :placeholder="t('settings.api.dataSources.form.tokenPlaceholder')"
              />
            </div>

            <div>
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.api.dataSources.form.interval') }}
              </label>
              <UInput v-model.number="formData.intervalMinutes" type="number" :min="1" class="w-full" />
            </div>

            <div class="flex items-center gap-2">
              <UButton
                color="primary"
                variant="soft"
                :loading="discovering"
                :disabled="!formData.baseUrl"
                @click="discoverSessions"
              >
                <UIcon name="i-heroicons-magnifying-glass" class="mr-1 h-4 w-4" />
                {{ t('settings.api.dataSources.discovery.browse') }}
              </UButton>
            </div>
          </template>

          <!-- Error -->
          <div
            v-if="discoveryError"
            class="rounded-md bg-red-50 p-3 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400"
          >
            {{ discoveryError }}
          </div>

          <!-- Session list -->
          <div v-if="hasDiscoveryRun">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-xs font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.api.dataSources.discovery.found', { count: remoteSessions.length }) }}
              </span>
              <button
                class="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-400"
                @click="toggleSelectAll"
              >
                {{
                  allSelected
                    ? t('settings.api.dataSources.discovery.deselectAll')
                    : t('settings.api.dataSources.discovery.selectAll')
                }}
              </button>
            </div>
            <div class="mb-3 flex items-center gap-2">
              <UInput
                v-model="discoveryKeyword"
                class="flex-1"
                :placeholder="t('settings.api.dataSources.discovery.searchPlaceholder')"
                @keydown.enter.prevent="searchSessions"
              />
              <UButton color="primary" variant="soft" :loading="discovering" @click="searchSessions">
                {{ t('settings.api.dataSources.discovery.search') }}
              </UButton>
            </div>
            <div class="mb-2 flex flex-wrap items-center gap-2">
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('settings.api.dataSources.discovery.selectByType') }}
              </span>
              <div class="inline-flex rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
                <button
                  v-for="option in sessionTypeSelectionOptions"
                  :key="option.value"
                  type="button"
                  class="rounded-md px-2.5 py-1 text-xs transition-colors"
                  :class="
                    activeSessionTypeFilter === option.value
                      ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-700 dark:text-blue-300'
                      : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                  "
                  :disabled="option.count === 0"
                  @click="setSessionTypeFilter(option.value)"
                >
                  {{ option.label }} ({{ option.count }})
                </button>
              </div>
            </div>
            <div
              v-if="remoteSessions.length > 0"
              class="max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-600"
            >
              <div
                v-for="session in visibleRemoteSessions"
                :key="session.id"
                class="flex items-center gap-3 border-b border-gray-100 px-3 py-2 last:border-0"
                :class="
                  subscribedRemoteIds?.has(session.id)
                    ? 'opacity-60'
                    : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800'
                "
                @click="toggleSession(session.id)"
              >
                <UCheckbox
                  :model-value="subscribedRemoteIds?.has(session.id) || selectedSessionIds.has(session.id)"
                  :disabled="subscribedRemoteIds?.has(session.id)"
                  @click.stop
                  @update:model-value="toggleSession(session.id)"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 truncate text-sm font-medium text-gray-900 dark:text-white">
                    {{ session.name }}
                    <span
                      v-if="subscribedRemoteIds?.has(session.id)"
                      class="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    >
                      {{ t('settings.api.dataSources.edit.subscribed') }}
                    </span>
                  </div>
                  <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <span class="rounded bg-gray-100 px-1 dark:bg-gray-700">{{ session.platform }}</span>
                    <span>{{ session.type }}</span>
                    <span v-if="session.messageCount !== undefined">
                      {{ formatMessageCount(session.messageCount) }}
                      {{ t('settings.api.dataSources.discovery.messages') }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div
              v-else
              class="rounded-lg border border-dashed border-gray-200 px-3 py-6 text-center text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400"
            >
              {{ t('settings.api.dataSources.discovery.found', { count: 0 }) }}
            </div>
            <div v-if="discoveryHasMore" class="mt-3 flex justify-center">
              <UButton color="neutral" variant="soft" :loading="loadingMore" @click="loadMoreSessions">
                {{ t('settings.api.dataSources.discovery.loadMore') }}
              </UButton>
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <UButton variant="soft" @click="closeModal">{{ t('common.cancel') }}</UButton>
            <UButton
              v-if="isManageMode"
              color="primary"
              :disabled="selectedSessionIds.size === 0"
              @click="handleSubmit"
            >
              {{ t('settings.api.dataSources.discovery.subscribe', { count: selectedSessionIds.size }) }}
            </UButton>
            <UButton v-else color="primary" :disabled="!formData.baseUrl" @click="handleSubmit">
              {{ t('settings.api.dataSources.addBtn') }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
