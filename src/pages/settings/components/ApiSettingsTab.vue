<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiServerStore } from '@/stores/apiServer'
import { storeToRefs } from 'pinia'

const { t } = useI18n()
const store = useApiServerStore()
const { config, status, loading, isRunning, hasError, isPortInUse } = storeToRefs(store)

const tokenVisible = ref(false)
const editingPort = ref(false)
const portInput = ref(5200)
const copied = ref(false)

let unlistenStartupError: (() => void) | null = null

onMounted(async () => {
  await store.refresh()
  portInput.value = config.value.port
  unlistenStartupError = store.listenStartupError()
})

onUnmounted(() => {
  unlistenStartupError?.()
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

function cancelPortEdit() {
  portInput.value = config.value.port
  editingPort.value = false
}

async function copyToken() {
  try {
    await navigator.clipboard.writeText(config.value.token)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // fallback
  }
}

async function handleRegenerateToken() {
  await store.regenerateToken()
}
</script>

<template>
  <div class="space-y-6">
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

        <!-- 运行状态 -->
        <div v-if="config.enabled" class="mt-3 flex items-center gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
          <span class="inline-block h-2 w-2 rounded-full" :class="isRunning ? 'bg-green-500' : hasError ? 'bg-red-500' : 'bg-gray-400'"></span>
          <span class="text-xs" :class="statusColor">{{ statusText }}</span>
          <span v-if="isRunning && status.port" class="ml-auto text-xs text-gray-500 dark:text-gray-400">
            {{ apiBaseUrl }}
          </span>
        </div>

        <!-- 端口占用提示 -->
        <div v-if="isPortInUse" class="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
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
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.api.port.label') }}
            </p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.api.port.desc') }}
            </p>
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
            <span class="text-sm font-mono text-gray-700 dark:text-gray-300">{{ config.port }}</span>
            <UButton size="xs" variant="ghost" @click="editingPort = true; portInput = config.port">
              {{ t('settings.api.port.edit') }}
            </UButton>
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
        <div>
          <p class="mb-2 text-sm font-medium text-gray-900 dark:text-white">
            {{ t('settings.api.token.label') }}
          </p>
          <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">
            {{ t('settings.api.token.desc') }}
          </p>
          <div v-if="config.token" class="flex items-center gap-2">
            <code class="flex-1 rounded bg-gray-100 px-3 py-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
              {{ tokenVisible ? config.token : maskedToken }}
            </code>
            <UButton size="xs" variant="ghost" @click="tokenVisible = !tokenVisible">
              <UIcon :name="tokenVisible ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'" class="h-4 w-4" />
            </UButton>
            <UButton size="xs" variant="ghost" @click="copyToken">
              <UIcon :name="copied ? 'i-heroicons-check' : 'i-heroicons-clipboard'" class="h-4 w-4" />
            </UButton>
          </div>
          <div v-else class="text-xs text-gray-400">
            {{ t('settings.api.token.noToken') }}
          </div>
          <div class="mt-3">
            <UButton size="xs" variant="soft" color="warning" @click="handleRegenerateToken">
              <UIcon name="i-heroicons-arrow-path" class="mr-1 h-3 w-3" />
              {{ t('settings.api.token.regenerate') }}
            </UButton>
          </div>
        </div>
      </div>
    </div>

    <!-- 使用说明 -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-book-open" class="h-4 w-4 text-teal-500" />
        {{ t('settings.api.usage.title') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <p class="mb-3 text-xs text-gray-600 dark:text-gray-400">
          {{ t('settings.api.usage.desc') }}
        </p>
        <div class="space-y-2">
          <div class="rounded bg-gray-100 p-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <span class="text-green-600 dark:text-green-400">GET</span> {{ apiBaseUrl }}/status
          </div>
          <div class="rounded bg-gray-100 p-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <span class="text-green-600 dark:text-green-400">GET</span> {{ apiBaseUrl }}/sessions
          </div>
          <div class="rounded bg-gray-100 p-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <span class="text-green-600 dark:text-green-400">GET</span> {{ apiBaseUrl }}/sessions/:id/messages?page=1&amp;limit=100
          </div>
          <div class="rounded bg-gray-100 p-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <span class="text-blue-600 dark:text-blue-400">POST</span> {{ apiBaseUrl }}/sessions/:id/sql
          </div>
        </div>
        <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">
          {{ t('settings.api.usage.authHint') }}
        </p>
        <div class="mt-1 rounded bg-gray-100 p-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          Authorization: Bearer {{ config.token ? maskedToken : 'clb_...' }}
        </div>
      </div>
    </div>
  </div>
</template>
