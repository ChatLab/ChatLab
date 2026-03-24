<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// 配置
const enabled = ref(false)
const transport = ref<'stdio' | 'http'>('http')
const port = ref(3000)
const autoStart = ref(false)

// 状态
const isRunning = ref(false)
const serverPid = ref<number>()
const serverUptime = ref<number>()
const isStarting = ref(false)
const isStopping = ref(false)
const portError = ref('')
const serverPath = ref<string>('')
const dbDir = ref<string>('')
const showStdioConfig = ref(false)

// 传输模式选项
const transportOptions = computed(() => [
  { label: 'HTTP', value: 'http' },
  { label: 'Stdio', value: 'stdio' },
])

// 格式化运行时间
const uptimeText = computed(() => {
  if (!serverUptime.value) return ''
  const seconds = Math.floor(serverUptime.value / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
})

// 加载配置
async function loadConfig() {
  try {
    const config = await window.mcpApi.getConfig()
    enabled.value = config.enabled
    transport.value = config.transport
    port.value = config.port
    autoStart.value = config.autoStart
  } catch (error) {
    console.error('Failed to load MCP config:', error)
  }
}

// 保存配置
async function saveConfig() {
  try {
    await window.mcpApi.saveConfig({
      enabled: enabled.value,
      transport: transport.value,
      port: port.value,
      autoStart: autoStart.value,
    })
  } catch (error) {
    console.error('Failed to save MCP config:', error)
  }
}

// 刷新状态
async function refreshStatus() {
  try {
    const status = await window.mcpApi.getStatus()
    isRunning.value = status.running
    serverPid.value = status.pid
    serverUptime.value = status.uptime
  } catch (error) {
    console.error('Failed to get MCP status:', error)
  }
}

// 启动服务
async function handleStart() {
  if (portError.value) return

  isStarting.value = true
  try {
    // 先保存配置
    await saveConfig()
    const result = await window.mcpApi.start()
    if (!result.success) {
      console.error('Failed to start MCP server:', result.error)
    }
    // 短暂延迟后刷新状态
    setTimeout(refreshStatus, 500)
  } catch (error) {
    console.error('Failed to start MCP server:', error)
  } finally {
    isStarting.value = false
  }
}

// 停止服务
async function handleStop() {
  isStopping.value = true
  try {
    await window.mcpApi.stop()
    setTimeout(refreshStatus, 500)
  } catch (error) {
    console.error('Failed to stop MCP server:', error)
  } finally {
    isStopping.value = false
  }
}

// 端口验证
function validatePort(val: number) {
  if (!val || val < 1 || val > 65535 || !Number.isInteger(val)) {
    portError.value = t('settings.basic.mcp.invalidPort')
    return
  }
  portError.value = ''
}

// 传输模式切换
async function handleTransportChange(mode: string | number) {
  transport.value = mode as 'stdio' | 'http'
  await saveConfig()
}

// 开关切换
async function handleEnabledChange(val: boolean) {
  enabled.value = val
  await saveConfig()
}

// 自启动切换
async function handleAutoStartChange(val: boolean) {
  autoStart.value = val
  await saveConfig()
}

// 端口失焦保存
async function handlePortBlur() {
  if (!portError.value) {
    await saveConfig()
  }
}

// 加载服务路径信息
async function loadServerPath() {
  try {
    const info = await window.mcpApi.getServerPath()
    if (info) {
      serverPath.value = info.path
      dbDir.value = info.dbDir
    }
  } catch {
    // ignore
  }
}

// 复制到剪贴板
async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // fallback
  }
}

// 定时刷新状态
let statusTimer: ReturnType<typeof setInterval>

onMounted(async () => {
  await loadConfig()
  await refreshStatus()
  await loadServerPath()
  statusTimer = setInterval(refreshStatus, 5000)
})

onUnmounted(() => {
  clearInterval(statusTimer)
})
</script>

<template>
  <div>
    <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
      <UIcon name="i-heroicons-server-stack" class="h-4 w-4 text-violet-500" />
      {{ t('settings.basic.mcp.title') }}
    </h3>
    <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
      <!-- 启用开关 -->
      <div class="flex items-center justify-between">
        <div class="flex-1 pr-4">
          <p class="text-sm font-medium text-gray-900 dark:text-white">
            {{ t('settings.basic.mcp.enable') }}
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ t('settings.basic.mcp.enableDesc') }}
          </p>
        </div>
        <USwitch :model-value="enabled" @update:model-value="handleEnabledChange" />
      </div>

      <template v-if="enabled">
        <!-- 运行状态 -->
        <div class="mt-4 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span
              class="inline-block h-2 w-2 rounded-full"
              :class="isRunning ? 'bg-green-500' : 'bg-gray-400'"
            />
            <span class="text-sm text-gray-700 dark:text-gray-300">
              {{ isRunning ? t('settings.basic.mcp.statusRunning') : t('settings.basic.mcp.statusStopped') }}
            </span>
            <span v-if="isRunning && uptimeText" class="text-xs text-gray-400">
              ({{ uptimeText }})
            </span>
            <span v-if="isRunning && serverPid" class="text-xs text-gray-400">
              PID: {{ serverPid }}
            </span>
          </div>
          <div class="flex gap-2">
            <UButton
              v-if="!isRunning"
              :loading="isStarting"
              :disabled="isStarting"
              color="primary"
              variant="soft"
              size="sm"
              @click="handleStart"
            >
              <UIcon name="i-heroicons-play" class="mr-1 h-4 w-4" />
              {{ t('settings.basic.mcp.start') }}
            </UButton>
            <UButton
              v-else
              :loading="isStopping"
              :disabled="isStopping"
              color="error"
              variant="soft"
              size="sm"
              @click="handleStop"
            >
              <UIcon name="i-heroicons-stop" class="mr-1 h-4 w-4" />
              {{ t('settings.basic.mcp.stop') }}
            </UButton>
          </div>
        </div>

        <!-- 传输模式 -->
        <div class="mt-4 flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.basic.mcp.transport') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.basic.mcp.transportDesc') }}
            </p>
          </div>
          <div class="w-48">
            <UTabs
              :model-value="transport"
              size="sm"
              class="gap-0"
              :items="transportOptions"
              @update:model-value="handleTransportChange"
            />
          </div>
        </div>

        <!-- HTTP 端口 -->
        <div v-if="transport === 'http'" class="mt-4">
          <div class="flex items-center justify-between">
            <div class="flex-1 pr-4">
              <p class="text-sm font-medium text-gray-900 dark:text-white">
                {{ t('settings.basic.mcp.port') }}
              </p>
            </div>
            <div class="w-32">
              <UInput
                v-model.number="port"
                type="number"
                :min="1"
                :max="65535"
                :color="portError ? 'error' : 'neutral'"
                size="sm"
                @input="validatePort(port)"
                @blur="handlePortBlur"
              />
            </div>
          </div>
          <p v-if="portError" class="mt-1 text-right text-xs text-red-500">{{ portError }}</p>
        </div>

        <!-- 自启动 -->
        <div class="mt-4 flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.basic.mcp.autoStart') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.basic.mcp.autoStartDesc') }}
            </p>
          </div>
          <USwitch :model-value="autoStart" @update:model-value="handleAutoStartChange" />
        </div>

        <!-- 外部配置提示 -->
        <div class="mt-4">
          <button
            class="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
            @click="showStdioConfig = !showStdioConfig"
          >
            <UIcon
              name="i-heroicons-chevron-right"
              class="h-3 w-3 transition-transform"
              :class="{ 'rotate-90': showStdioConfig }"
            />
            {{ t('settings.basic.mcp.externalConfig') }}
          </button>

          <div v-if="showStdioConfig" class="mt-2 rounded-md bg-gray-100 p-3 dark:bg-gray-800">
            <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.basic.mcp.externalConfigDesc') }}
            </p>
            <div class="space-y-2">
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                  {{ t('settings.basic.mcp.serverEntry') }}
                </label>
                <div class="flex items-center gap-1">
                  <code class="flex-1 truncate rounded bg-gray-200 px-2 py-1 text-xs dark:bg-gray-700">
                    {{ serverPath || '...' }}
                  </code>
                  <UButton
                    v-if="serverPath"
                    variant="ghost"
                    size="xs"
                    @click="copyToClipboard(serverPath)"
                  >
                    <UIcon name="i-heroicons-clipboard" class="h-3 w-3" />
                  </UButton>
                </div>
              </div>
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                  {{ t('settings.basic.mcp.dbDirectory') }}
                </label>
                <div class="flex items-center gap-1">
                  <code class="flex-1 truncate rounded bg-gray-200 px-2 py-1 text-xs dark:bg-gray-700">
                    {{ dbDir || '...' }}
                  </code>
                  <UButton
                    v-if="dbDir"
                    variant="ghost"
                    size="xs"
                    @click="copyToClipboard(dbDir)"
                  >
                    <UIcon name="i-heroicons-clipboard" class="h-3 w-3" />
                  </UButton>
                </div>
              </div>
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                  {{ t('settings.basic.mcp.stdioCommand') }}
                </label>
                <div class="flex items-center gap-1">
                  <code class="flex-1 truncate rounded bg-gray-200 px-2 py-1 text-xs dark:bg-gray-700">
                    node {{ serverPath }} --db-dir {{ dbDir }}
                  </code>
                  <UButton
                    v-if="serverPath && dbDir"
                    variant="ghost"
                    size="xs"
                    @click="copyToClipboard(`node ${serverPath} --db-dir ${dbDir}`)"
                  >
                    <UIcon name="i-heroicons-clipboard" class="h-3 w-3" />
                  </UButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
