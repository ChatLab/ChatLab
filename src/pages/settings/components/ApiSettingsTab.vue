<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiServerStore, type DataSource, type ImportSession } from '@/stores/apiServer'
import { storeToRefs } from 'pinia'
import { SubTabs } from '@/components/UI'
import DataSourceAddModal from './API/DataSourceAddModal.vue'
import DataSourceEditModal from './API/DataSourceEditModal.vue'

const { t, locale } = useI18n()
const store = useApiServerStore()
const { config, status, loading, isRunning, hasError, isPortInUse, dataSources, pullingId } = storeToRefs(store)

const activeSubTab = ref('sync')

const subTabs = computed(() => [
  {
    id: 'sync',
    label: t('settings.tabs.apiSubTabs.autoSync'),
    icon: 'i-heroicons-cloud-arrow-down',
  },
  {
    id: 'api',
    label: t('settings.tabs.apiSubTabs.apiService'),
    icon: 'i-heroicons-server-stack',
  },
])

const tokenVisible = ref(false)
const editingPort = ref(false)
const portInput = ref(5200)
const copied = ref(false)

const showAddModal = ref(false)
const showEditModal = ref(false)
const editingDataSource = ref<DataSource | null>(null)
const showManageModal = ref(false)
const managingDataSource = ref<DataSource | null>(null)
const showDeleteModal = ref(false)
const deletingDataSource = ref<DataSource | null>(null)

let unlistenStartupError: (() => void) | null = null
let unlistenPullResult: (() => void) | null = null

onMounted(async () => {
  await store.refresh()
  portInput.value = config.value.port
  unlistenStartupError = store.listenStartupError()
  unlistenPullResult = store.listenPullResult()
})

onUnmounted(() => {
  unlistenStartupError?.()
  unlistenPullResult?.()
})

const maskedToken = computed(() => {
  if (!config.value.token) return ''
  return config.value.token.slice(0, 8) + '••••••••••••••••'
})

const statusText = computed(() => {
  if (loading.value) return t('settings.api.status.starting')
  if (isRunning.value) return t('settings.api.status.running')
  if (isPortInUse.value) return t('settings.api.status.portInUse')
  if (hasError.value) return t('settings.api.status.error')
  return t('settings.api.status.stopped')
})

const statusColor = computed(() => {
  if (loading.value) return 'text-yellow-500'
  if (isRunning.value) return 'text-green-500'
  if (hasError.value) return 'text-red-500'
  return 'text-gray-400'
})

const apiBaseUrl = computed(() => {
  const port = status.value.port || config.value.port
  return `http://127.0.0.1:${port}/api/v1`
})

const apiDocUrl = computed(() => {
  const isChinese = locale.value === 'zh-CN' || locale.value === 'zh-TW'
  return isChinese ? 'https://chatlab.fun/cn/standard/chatlab-api.html' : 'https://chatlab.fun/en/chatlab-api.html'
})

async function toggleEnabled() {
  await store.setEnabled(!config.value.enabled)
}

async function savePort() {
  const port = portInput.value
  if (port < 1024 || port > 65535) return
  await store.setPort(port)
  editingPort.value = false
}

function startPortEdit() {
  editingPort.value = true
  portInput.value = config.value.port
}

function cancelPortEdit() {
  portInput.value = config.value.port
  editingPort.value = false
}

async function copyToken() {
  try {
    await navigator.clipboard.writeText(config.value.token)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    /* fallback */
  }
}

async function handleRegenerateToken() {
  await store.regenerateToken()
}

// ==================== Data Source ====================

function openEditSource(ds: DataSource) {
  editingDataSource.value = ds
  showEditModal.value = true
}

async function handleEditSaved(updates: { name: string; baseUrl: string; token: string; intervalMinutes: number }) {
  if (!editingDataSource.value) return
  await store.updateDataSource(editingDataSource.value.id, updates)
}

function openManageSessions(ds: DataSource) {
  managingDataSource.value = ds
  showManageModal.value = true
}

async function handleSessionsAdded(sourceId: string, sessions: Array<{ name: string; remoteSessionId: string }>) {
  await store.addImportSessions(sourceId, sessions)
}

async function toggleSourceEnabled(ds: DataSource) {
  await store.updateDataSource(ds.id, { enabled: !ds.enabled })
}

function confirmDeleteSource(ds: DataSource) {
  deletingDataSource.value = ds
  showDeleteModal.value = true
}

async function removeSource() {
  if (!deletingDataSource.value) return
  const ds = deletingDataSource.value
  if (ds.enabled) {
    await store.updateDataSource(ds.id, { enabled: false })
  }
  await store.deleteDataSource(ds.id)
  showDeleteModal.value = false
  deletingDataSource.value = null
}

async function removeSession(ds: DataSource, sess: ImportSession) {
  await store.removeImportSession(ds.id, sess.id)
}

async function syncAllInSource(ds: DataSource) {
  await store.triggerPullAll(ds.id)
}

async function syncSession(ds: DataSource, sess: ImportSession) {
  await store.triggerPull(ds.id, sess.id)
}

function formatTime(ts: number): string {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString()
}

function subscribedRemoteIds(ds: DataSource): Set<string> {
  return new Set(ds.sessions.map((s) => s.remoteSessionId))
}
</script>

<template>
  <div class="flex h-full flex-col -mx-6 -mt-6">
    <SubTabs v-model="activeSubTab" :items="subTabs" persist-key="apiSubTab" />

    <div class="flex-1 min-h-0 overflow-auto">
      <div class="space-y-6 px-6 pt-4 pb-6">
        <!-- ==================== Auto Sync Sub-Tab ==================== -->
        <template v-if="activeSubTab === 'sync'">
          <div>
            <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <UIcon name="i-heroicons-cloud-arrow-down" class="h-4 w-4 text-indigo-500" />
              {{ t('settings.api.dataSources.title') }}
            </h3>
            <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
              <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">
                {{ t('settings.api.dataSources.desc') }}
              </p>

              <!-- Data source list -->
              <div v-if="dataSources.length > 0" class="mb-4 space-y-4">
                <div
                  v-for="ds in dataSources"
                  :key="ds.id"
                  class="rounded-lg border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800"
                >
                  <!-- Source header -->
                  <div class="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-700">
                    <div class="flex items-center gap-2">
                      <UIcon name="i-heroicons-server-stack" class="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
                      <span v-if="ds.name" class="text-xs font-medium text-gray-700 dark:text-gray-300">{{ ds.name }}</span>
                      <span class="text-xs font-mono text-gray-500 dark:text-gray-400">{{ ds.baseUrl }}</span>
                      <span v-if="!ds.enabled" class="text-xs text-gray-400">({{ t('settings.api.dataSources.disabled') }})</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <UButton size="xs" variant="ghost" @click="openEditSource(ds)">
                        <UIcon name="i-heroicons-pencil-square" class="mr-1 h-3.5 w-3.5" />
                        {{ t('settings.api.dataSources.edit.editSource') }}
                      </UButton>
                      <UButton size="xs" variant="ghost" @click="openManageSessions(ds)">
                        <UIcon name="i-heroicons-queue-list" class="mr-1 h-3.5 w-3.5" />
                        {{ t('settings.api.dataSources.edit.manageSessions') }}
                      </UButton>
                      <UButton size="xs" variant="ghost" @click="toggleSourceEnabled(ds)">
                        <UIcon :name="ds.enabled ? 'i-heroicons-pause' : 'i-heroicons-play'" class="h-3.5 w-3.5" />
                      </UButton>
                      <UButton size="xs" variant="ghost" @click="syncAllInSource(ds)">
                        <UIcon name="i-heroicons-arrow-path" class="h-3.5 w-3.5" />
                      </UButton>
                      <UButton size="xs" variant="ghost" color="error" @click="confirmDeleteSource(ds)">
                        <UIcon name="i-heroicons-trash" class="h-3.5 w-3.5" />
                      </UButton>
                    </div>
                  </div>

                  <!-- Session items -->
                  <div v-if="ds.sessions.length > 0" class="max-h-80 overflow-y-auto">
                    <div
                      v-for="sess in ds.sessions"
                      :key="sess.id"
                      class="border-b border-gray-50 px-3 py-2.5 last:border-0 dark:border-gray-700/50"
                    >
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                          <span
                            class="inline-block h-2 w-2 rounded-full"
                            :class="
                              sess.lastStatus === 'success'
                                ? 'bg-green-500'
                                : sess.lastStatus === 'error'
                                  ? 'bg-red-500'
                                  : 'bg-gray-400'
                            "
                          ></span>
                          <span class="text-sm font-medium text-gray-900 dark:text-white">{{ sess.name }}</span>
                        </div>
                        <div class="flex items-center gap-1">
                          <UButton
                            size="xs"
                            variant="ghost"
                            :loading="pullingId === sess.id"
                            @click="syncSession(ds, sess)"
                          >
                            <UIcon name="i-heroicons-arrow-path" class="h-3.5 w-3.5" />
                          </UButton>
                          <UButton size="xs" variant="ghost" color="error" @click="removeSession(ds, sess)">
                            <UIcon name="i-heroicons-trash" class="h-3.5 w-3.5" />
                          </UButton>
                        </div>
                      </div>
                      <div class="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <span>
                          {{ t('settings.api.dataSources.every') }} {{ ds.intervalMinutes }}
                          {{ t('settings.api.dataSources.minutes') }}
                        </span>
                        <template v-if="sess.lastPullAt">
                          <span class="text-gray-300 dark:text-gray-600">·</span>
                          <span class="text-gray-400">
                            {{ t('settings.api.dataSources.lastSync') }}: {{ formatTime(sess.lastPullAt) }}
                          </span>
                          <span v-if="sess.lastStatus === 'success'" class="text-green-500">
                            (+{{ sess.lastNewMessages }})
                          </span>
                          <span v-if="sess.lastStatus === 'error'" class="text-red-500">{{ sess.lastError }}</span>
                        </template>
                      </div>
                    </div>
                  </div>
                  <div v-else class="px-3 py-4 text-center text-xs text-gray-400">
                    {{ t('settings.api.dataSources.noSessions') }}
                  </div>
                </div>
              </div>

              <div v-else class="mb-4 py-4 text-center text-xs text-gray-400">
                {{ t('settings.api.dataSources.empty') }}
              </div>

              <UButton variant="soft" @click="showAddModal = true">
                <UIcon name="i-heroicons-plus" class="mr-2 h-4 w-4" />
                {{ t('settings.api.dataSources.addBtn') }}
              </UButton>
            </div>
          </div>
        </template>

        <!-- ==================== API Service Sub-Tab ==================== -->
        <template v-if="activeSubTab === 'api'">
          <!-- Service toggle -->
          <div>
            <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <UIcon name="i-heroicons-server-stack" class="h-4 w-4 text-blue-500" />
              {{ t('settings.api.service.title') }}
            </h3>
            <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
              <div class="flex items-center justify-between">
                <div class="flex-1 pr-4">
                  <p class="text-sm font-medium text-gray-900 dark:text-white">
                    {{ t('settings.api.service.enable') }}
                  </p>
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {{ t('settings.api.service.enableDesc') }}
                  </p>
                </div>
                <USwitch :model-value="config.enabled" :loading="loading" @update:model-value="toggleEnabled" />
              </div>
              <div
                v-if="config.enabled"
                class="mt-3 flex items-center gap-2 border-t border-gray-200 pt-3 dark:border-gray-700"
              >
                <span
                  class="inline-block h-2 w-2 rounded-full"
                  :class="isRunning ? 'bg-green-500' : hasError ? 'bg-red-500' : 'bg-gray-400'"
                ></span>
                <span class="text-xs" :class="statusColor">{{ statusText }}</span>
                <span v-if="isRunning && status.port" class="ml-auto text-xs text-gray-500 dark:text-gray-400">
                  {{ apiBaseUrl }}
                </span>
              </div>
              <div
                v-if="isPortInUse"
                class="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400"
              >
                {{ t('settings.api.service.portInUseHint') }}
              </div>
            </div>
          </div>

          <!-- Port -->
          <div>
            <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <UIcon name="i-heroicons-globe-alt" class="h-4 w-4 text-purple-500" />
              {{ t('settings.api.port.title') }}
            </h3>
            <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
              <div class="flex items-center justify-between">
                <div class="flex-1 pr-4">
                  <p class="text-sm font-medium text-gray-900 dark:text-white">{{ t('settings.api.port.label') }}</p>
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('settings.api.port.desc') }}</p>
                </div>
                <div v-if="editingPort" class="flex items-center gap-2">
                  <UInput v-model.number="portInput" type="number" :min="1024" :max="65535" size="sm" class="w-24" />
                  <UButton size="xs" color="primary" :loading="loading" @click="savePort">
                    {{ t('settings.api.port.save') }}
                  </UButton>
                  <UButton size="xs" variant="ghost" @click="cancelPortEdit">
                    {{ t('settings.api.port.cancel') }}
                  </UButton>
                </div>
                <div v-else class="flex items-center gap-2">
                  <span class="font-mono text-sm text-gray-700 dark:text-gray-300">{{ config.port }}</span>
                  <UButton size="xs" variant="ghost" @click="startPortEdit">
                    {{ t('settings.api.port.edit') }}
                  </UButton>
                </div>
              </div>
            </div>
          </div>

          <!-- Token -->
          <div>
            <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <UIcon name="i-heroicons-key" class="h-4 w-4 text-amber-500" />
              {{ t('settings.api.token.title') }}
            </h3>
            <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
              <p class="mb-2 text-sm font-medium text-gray-900 dark:text-white">{{ t('settings.api.token.label') }}</p>
              <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">{{ t('settings.api.token.desc') }}</p>
              <div v-if="config.token" class="flex items-center gap-2">
                <code
                  class="flex-1 rounded bg-gray-100 px-3 py-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                >
                  {{ tokenVisible ? config.token : maskedToken }}
                </code>
                <UButton size="xs" variant="ghost" @click="tokenVisible = !tokenVisible">
                  <UIcon :name="tokenVisible ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'" class="h-4 w-4" />
                </UButton>
                <UButton size="xs" variant="ghost" @click="copyToken">
                  <UIcon :name="copied ? 'i-heroicons-check' : 'i-heroicons-clipboard'" class="h-4 w-4" />
                </UButton>
              </div>
              <div v-else class="text-xs text-gray-400">{{ t('settings.api.token.noToken') }}</div>
              <div class="mt-3">
                <UButton variant="soft" color="warning" @click="handleRegenerateToken">
                  <UIcon name="i-heroicons-arrow-path" class="mr-1 h-4 w-4" />
                  {{ t('settings.api.token.regenerate') }}
                </UButton>
              </div>
              <div class="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700">
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('settings.api.usage.authHint') }}</p>
                <div
                  class="mt-1 rounded bg-gray-100 p-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                >
                  Authorization: Bearer {{ config.token ? maskedToken : 'clb_...' }}
                </div>
              </div>
            </div>
          </div>

          <!-- Usage guide -->
          <div>
            <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <UIcon name="i-heroicons-book-open" class="h-4 w-4 text-teal-500" />
              {{ t('settings.api.usage.title') }}
            </h3>
            <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
              <p class="text-xs text-gray-600 dark:text-gray-400">
                {{ t('settings.api.usage.desc') }}
              </p>
              <a
                :href="apiDocUrl"
                target="_blank"
                class="mt-2 inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
              >
                <UIcon name="i-heroicons-arrow-top-right-on-square" class="h-3.5 w-3.5" />
                {{ t('settings.api.usage.docLink') }}
              </a>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Add data source modal -->
    <DataSourceAddModal v-model:open="showAddModal" @source-added="store.fetchDataSources()" />

    <!-- Edit data source modal -->
    <DataSourceEditModal
      v-model:open="showEditModal"
      :data-source="editingDataSource"
      @saved="handleEditSaved"
    />

    <!-- Manage import sessions modal -->
    <DataSourceAddModal
      v-if="managingDataSource"
      v-model:open="showManageModal"
      :manage-source="managingDataSource"
      :subscribed-remote-ids="subscribedRemoteIds(managingDataSource)"
      @sessions-added="handleSessionsAdded"
    />

    <!-- Delete confirmation modal -->
    <UModal v-model:open="showDeleteModal">
      <template #content>
        <div class="p-4">
          <h3 class="mb-3 font-semibold text-gray-900 dark:text-white">
            {{ t('settings.api.dataSources.deleteConfirm.title') }}
          </h3>
          <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
            {{ t('settings.api.dataSources.deleteConfirm.message', { name: deletingDataSource?.baseUrl }) }}
          </p>
          <div class="flex justify-end gap-2">
            <UButton variant="soft" @click="showDeleteModal = false">{{ t('common.cancel') }}</UButton>
            <UButton color="error" @click="removeSource">{{ t('common.delete') }}</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
