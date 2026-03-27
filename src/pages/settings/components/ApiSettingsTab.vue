<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiServerStore, type DataSource } from '@/stores/apiServer'
import { storeToRefs } from 'pinia'
import DataSourceAddModal from './API/DataSourceAddModal.vue'

const { t } = useI18n()
const store = useApiServerStore()
const { config, status, loading, isRunning, hasError, isPortInUse, dataSources, pullingId } = storeToRefs(store)

const tokenVisible = ref(false)
const editingPort = ref(false)
const portInput = ref(5200)
const copied = ref(false)
const showAddModal = ref(false)

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

// ==================== 数据源管理 ====================

async function handleSourceAdded(data: {
  name: string
  url: string
  token: string
  intervalMinutes: number
  enabled: boolean
  targetSessionId: string
}) {
  await store.addDataSource(data)
}

async function toggleSourceEnabled(ds: DataSource) {
  await store.updateDataSource(ds.id, { enabled: !ds.enabled })
}

async function removeSource(ds: DataSource) {
  await store.deleteDataSource(ds.id)
}

async function pullNow(ds: DataSource) {
  await store.triggerPull(ds.id)
}

function formatTime(ts: number): string {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString()
}
</script>

<template>
  <div class="space-y-6">
    <!-- Beta 提示 -->
    <div class="rounded-lg border border-amber-200/60 bg-amber-50 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-500/10">
      <div class="flex items-start gap-3">
        <UIcon name="i-heroicons-exclamation-triangle" class="mt-0.5 h-5 w-5 shrink-0 text-amber-500 dark:text-amber-400" />
        <p class="text-sm font-medium text-amber-800 dark:text-amber-300">
          {{ t('settings.api.betaWarning') }}
        </p>
      </div>
    </div>

    <!-- 服务开关 -->
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

    <!-- 端口设置 -->
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
            <UButton size="xs" variant="ghost" @click="cancelPortEdit">{{ t('settings.api.port.cancel') }}</UButton>
          </div>
          <div v-else class="flex items-center gap-2">
            <span class="text-sm font-mono text-gray-700 dark:text-gray-300">{{ config.port }}</span>
            <UButton size="xs" variant="ghost" @click="startPortEdit">{{ t('settings.api.port.edit') }}</UButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Token 管理 -->
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
          <div class="mt-1 rounded bg-gray-100 p-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            Authorization: Bearer {{ config.token ? maskedToken : 'clb_...' }}
          </div>
        </div>
      </div>
    </div>

    <!-- 数据源管理 -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-cloud-arrow-down" class="h-4 w-4 text-indigo-500" />
        {{ t('settings.api.dataSources.title') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">
          {{ t('settings.api.dataSources.desc') }}
        </p>

        <!-- 数据源列表 -->
        <div v-if="dataSources.length > 0" class="mb-4 space-y-3">
          <div
            v-for="ds in dataSources"
            :key="ds.id"
            class="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-600 dark:bg-gray-800"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span
                  class="inline-block h-2 w-2 rounded-full"
                  :class="
                    ds.lastStatus === 'success'
                      ? 'bg-green-500'
                      : ds.lastStatus === 'error'
                        ? 'bg-red-500'
                        : 'bg-gray-400'
                  "
                ></span>
                <span class="text-sm font-medium text-gray-900 dark:text-white">{{ ds.name }}</span>
                <span v-if="!ds.enabled" class="text-xs text-gray-400">
                  ({{ t('settings.api.dataSources.disabled') }})
                </span>
              </div>
              <div class="flex items-center gap-1">
                <UButton size="xs" variant="ghost" :loading="pullingId === ds.id" @click="pullNow(ds)">
                  <UIcon name="i-heroicons-arrow-path" class="h-3.5 w-3.5" />
                </UButton>
                <UButton size="xs" variant="ghost" @click="toggleSourceEnabled(ds)">
                  <UIcon :name="ds.enabled ? 'i-heroicons-pause' : 'i-heroicons-play'" class="h-3.5 w-3.5" />
                </UButton>
                <UButton size="xs" variant="ghost" color="error" @click="removeSource(ds)">
                  <UIcon name="i-heroicons-trash" class="h-3.5 w-3.5" />
                </UButton>
              </div>
            </div>
            <div class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              <span class="font-mono">{{ ds.url }}</span>
              <span class="mx-2">·</span>
              <span>
                {{ t('settings.api.dataSources.every') }} {{ ds.intervalMinutes }}
                {{ t('settings.api.dataSources.minutes') }}
              </span>
            </div>
            <div v-if="ds.lastPullAt" class="mt-1 text-xs text-gray-400">
              {{ t('settings.api.dataSources.lastSync') }}: {{ formatTime(ds.lastPullAt) }}
              <span v-if="ds.lastStatus === 'success'" class="text-green-500">(+{{ ds.lastNewMessages }})</span>
              <span v-if="ds.lastStatus === 'error'" class="text-red-500">
                {{ ds.lastError }}
              </span>
            </div>
          </div>
        </div>

        <div v-else class="mb-4 text-center text-xs text-gray-400 py-4">
          {{ t('settings.api.dataSources.empty') }}
        </div>

        <UButton variant="soft" @click="showAddModal = true">
          <UIcon name="i-heroicons-plus" class="mr-2 h-4 w-4" />
          {{ t('settings.api.dataSources.addBtn') }}
        </UButton>
      </div>
    </div>

    <!-- 使用说明 -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-book-open" class="h-4 w-4 text-teal-500" />
        {{ t('settings.api.usage.title') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <p class="mb-3 text-xs text-gray-600 dark:text-gray-400">{{ t('settings.api.usage.desc') }}</p>
        <div class="space-y-2">
          <div class="rounded bg-gray-100 p-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <span class="text-green-600 dark:text-green-400">GET</span>
            {{ apiBaseUrl }}/status
          </div>
          <div class="rounded bg-gray-100 p-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <span class="text-green-600 dark:text-green-400">GET</span>
            {{ apiBaseUrl }}/sessions
          </div>
          <div class="rounded bg-gray-100 p-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <span class="text-green-600 dark:text-green-400">GET</span>
            {{ apiBaseUrl }}/sessions/:id/messages?page=1&amp;limit=100
          </div>
          <div class="rounded bg-gray-100 p-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <span class="text-blue-600 dark:text-blue-400">POST</span>
            {{ apiBaseUrl }}/sessions/:id/sql
          </div>
        </div>
      </div>
    </div>

    <!-- 添加数据源弹窗 -->
    <DataSourceAddModal v-model:open="showAddModal" @added="handleSourceAdded" />
  </div>
</template>
