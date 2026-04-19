<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiServerStore, type DataSource, type RemoteSession } from '@/stores/apiServer'

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
const discoveryError = ref('')

watch(
  () => props.open,
  async (val) => {
    if (val) {
      if (isManageMode.value && props.manageSource) {
        formData.value = {
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
      if (isManageMode.value) {
        await discoverSessions()
      }
    }
  },
  { immediate: true }
)

const availableSessions = computed(() =>
  remoteSessions.value.filter((s) => !props.subscribedRemoteIds?.has(s.id))
)

const allSelected = computed(
  () => availableSessions.value.length > 0 && selectedSessionIds.value.size === availableSessions.value.length
)

function toggleSelectAll() {
  if (allSelected.value) {
    selectedSessionIds.value = new Set()
  } else {
    selectedSessionIds.value = new Set(availableSessions.value.map((s) => s.id))
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
  if (!formData.value.baseUrl) return
  discovering.value = true
  discoveryError.value = ''
  remoteSessions.value = []
  selectedSessionIds.value = new Set()
  try {
    remoteSessions.value = await store.fetchRemoteSessions(formData.value.baseUrl, formData.value.token)
  } catch (err: any) {
    discoveryError.value = err.message || t('settings.api.dataSources.discovery.error')
  } finally {
    discovering.value = false
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
  <UModal :open="open" @update:open="emit('update:open', $event)">
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
              <UInput v-model="formData.baseUrl" class="w-full" placeholder="https://example.com" />
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
          <div v-if="remoteSessions.length > 0">
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
            <div class="max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-600">
              <div
                v-for="session in remoteSessions"
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
