<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// 配置
const enabled = ref(false)
const transport = ref<'stdio' | 'http'>('http')
const port = ref(3000)
const apiKey = ref('')

// 状态
const isRunning = ref(false)
const serverPid = ref<number>()
const serverUptime = ref<number>()
const isStarting = ref(false)
const isStopping = ref(false)
const portError = ref('')
const startError = ref('')
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
    apiKey.value = config.apiKey || ''
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
      autoStart: false,
      apiKey: apiKey.value,
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

// Claude Desktop JSON 配置片段
const claudeDesktopSnippet = computed(() => {
  if (transport.value === 'http') {
    const entry: Record<string, unknown> = { url: `http://127.0.0.1:${port.value}/sse` }
    if (apiKey.value) {
      entry.headers = { Authorization: `Bearer ${apiKey.value}` }
    }
    return JSON.stringify({ mcpServers: { chatlab: entry } }, null, 2)
  }
  return JSON.stringify({
    mcpServers: {
      chatlab: {
        command: 'node',
        args: [serverPath.value || '[server-path]', '--db-dir', dbDir.value || '[db-dir]'],
      },
    },
  }, null, 2)
})

// 停止服务（内部使用）
async function stopServer() {
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
  if (mode === 'stdio' && isRunning.value) {
    // 切到 stdio：停止正在运行的 HTTP server
    await stopServer()
  } else if (mode === 'http' && enabled.value && !isRunning.value) {
    // 切到 HTTP 且已启用：自动启动服务
    startError.value = ''
    isStarting.value = true
    try {
      const result = await window.mcpApi.start()
      if (!result.success) {
        startError.value = result.error || t('settings.basic.mcp.startError')
      }
      setTimeout(refreshStatus, 500)
    } catch (error) {
      startError.value = error instanceof Error ? error.message : t('settings.basic.mcp.startError')
    } finally {
      isStarting.value = false
    }
  }
}

// 开关切换：HTTP 模式直接启动/停止服务，Stdio 模式仅保存配置
async function handleEnabledChange(val: boolean) {
  enabled.value = val
  startError.value = ''
  if (transport.value === 'http') {
    if (val) {
      if (portError.value) {
        enabled.value = false
        return
      }
      isStarting.value = true
      try {
        await saveConfig()
        const result = await window.mcpApi.start()
        if (!result.success) {
          startError.value = result.error || t('settings.basic.mcp.startError')
          console.error('Failed to start MCP server:', result.error)
        }
        setTimeout(refreshStatus, 500)
      } catch (error) {
        startError.value = error instanceof Error ? error.message : t('settings.basic.mcp.startError')
        console.error('Failed to start MCP server:', error)
      } finally {
        isStarting.value = false
      }
    } else {
      isStopping.value = true
      try {
        await saveConfig()
        await window.mcpApi.stop()
        setTimeout(refreshStatus, 500)
      } catch (error) {
        console.error('Failed to stop MCP server:', error)
      } finally {
        isStopping.value = false
      }
    }
  } else {
    await saveConfig()
  }
}

// 端口失焦保存
async function handlePortBlur() {
  if (!portError.value) {
    await saveConfig()
  }
}

// API Key 失焦保存
async function handleApiKeyBlur() {
  await saveConfig()
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
        <USwitch
          :model-value="enabled"
          :loading="isStarting || isStopping"
          :disabled="isStarting || isStopping"
          @update:model-value="handleEnabledChange"
        />
      </div>

      <template v-if="enabled">
        <!-- 运行状态（仅 HTTP 模式） -->
        <div v-if="transport === 'http'" class="mt-4">
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
          <p v-if="startError" class="mt-1 text-xs text-red-500">{{ startError }}</p>
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

        <!-- API Key -->
        <div v-if="transport === 'http'" class="mt-4">
          <div class="flex items-center justify-between">
            <div class="flex-1 pr-4">
              <p class="text-sm font-medium text-gray-900 dark:text-white">
                {{ t('settings.basic.mcp.apiKey') }}
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('settings.basic.mcp.apiKeyDesc') }}
              </p>
            </div>
            <div class="w-64">
              <UInput
                v-model="apiKey"
                type="password"
                :placeholder="t('settings.basic.mcp.apiKeyPlaceholder')"
                size="sm"
                @blur="handleApiKeyBlur"
              />
            </div>
          </div>
        </div>

        <!-- 安全警告 -->
        <div v-if="transport === 'http' && isRunning && !apiKey" class="mt-3">
          <div class="rounded-md bg-amber-50 p-3 dark:bg-amber-900/20">
            <div class="flex items-center gap-2">
              <UIcon name="i-heroicons-exclamation-triangle" class="h-4 w-4 flex-shrink-0 text-amber-500" />
              <p class="text-xs text-amber-700 dark:text-amber-300">
                {{ t('settings.basic.mcp.noAuthWarning') }}
              </p>
            </div>
          </div>
        </div>

        <!-- REST API URL -->
        <div v-if="transport === 'http' && isRunning" class="mt-3">
          <div class="flex items-center gap-2">
            <span class="text-xs text-gray-500 dark:text-gray-400">REST API:</span>
            <code class="rounded bg-gray-200 px-2 py-0.5 text-xs dark:bg-gray-700">
              http://127.0.0.1:{{ port }}/api/v1/
            </code>
            <UButton
              variant="ghost"
              size="xs"
              @click="copyToClipboard(`http://127.0.0.1:${port}/api/v1/`)"
            >
              <UIcon name="i-heroicons-clipboard" class="h-3 w-3" />
            </UButton>
          </div>
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
            <div v-if="transport === 'stdio'" class="mb-3 rounded-md bg-amber-50 p-2 dark:bg-amber-900/20">
              <div class="flex items-start gap-2">
                <UIcon name="i-heroicons-exclamation-triangle" class="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
                <p class="text-xs text-amber-700 dark:text-amber-300">
                  {{ t('settings.basic.mcp.stdioAbiWarning') }}
                </p>
              </div>
            </div>
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
              <div>
                <div class="mb-1 flex items-center justify-between">
                  <label class="text-xs font-medium text-gray-600 dark:text-gray-400">
                    {{ t('settings.basic.mcp.claudeDesktopConfig') }}
                  </label>
                  <UButton
                    variant="ghost"
                    size="xs"
                    @click="copyToClipboard(claudeDesktopSnippet)"
                  >
                    <UIcon name="i-heroicons-clipboard" class="h-3 w-3" />
                  </UButton>
                </div>
                <p class="mb-1 text-xs text-gray-400 dark:text-gray-500">
                  {{ t('settings.basic.mcp.claudeDesktopConfigDesc') }}
                </p>
                <pre class="overflow-x-auto rounded bg-gray-200 px-2 py-1 text-xs dark:bg-gray-700">{{ claudeDesktopSnippet }}</pre>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
