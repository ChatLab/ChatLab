<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useClipboard } from '@vueuse/core'

const { t } = useI18n()
const { copy, copied } = useClipboard({ copiedDuring: 2000 })

type McpMode = 'npx' | 'cli' | 'desktop'
type McpClient = 'claude' | 'cursor' | 'other'

const selectedMode = ref<McpMode>('npx')
const selectedClient = ref<McpClient>('cursor')

const modeOptions = computed(() => [
  { label: 'npx', value: 'npx' },
  { label: 'CLI', value: 'cli' },
  { label: t('settings.mcp.modes.desktop'), value: 'desktop' },
])

const clientOptions = computed(() => [
  { label: 'Cursor', value: 'cursor' },
  { label: 'Claude Desktop', value: 'claude' },
  { label: t('settings.mcp.clients.other'), value: 'other' },
])

const mcpConfig = computed(() => {
  const serverConfig = buildServerConfig(selectedMode.value)
  if (selectedClient.value === 'other') return serverConfig
  return wrapForClient(selectedClient.value, serverConfig)
})

const configJson = computed(() => JSON.stringify(mcpConfig.value, null, 2))

const isDesktopMode = computed(() => selectedMode.value === 'desktop')

function buildServerConfig(mode: McpMode): Record<string, unknown> {
  switch (mode) {
    case 'npx':
      return { command: 'npx', args: ['-y', 'chatlab-mcp'] }
    case 'cli':
      return { command: 'chatlab', args: ['mcp'] }
    case 'desktop':
      return { command: 'npx', args: ['-y', 'chatlab-mcp'] }
  }
}

function wrapForClient(client: 'claude' | 'cursor', server: Record<string, unknown>) {
  if (client === 'cursor') {
    return { mcpServers: { chatlab: server } }
  }
  return { mcpServers: { chatlab: server } }
}

function handleCopy() {
  copy(configJson.value)
}
</script>

<template>
  <div class="space-y-6 pb-6">
    <!-- MCP Overview -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-command-line" class="h-4 w-4 text-emerald-500" />
        {{ t('settings.mcp.overview.title') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <p class="text-sm text-gray-600 dark:text-gray-300">
          {{ t('settings.mcp.overview.description') }}
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <span
            class="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
            {{ t('settings.mcp.overview.toolCount', { count: 33 }) }}
          </span>
          <span
            class="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-blue-500"></span>
            {{ t('settings.mcp.overview.resourceCount', { count: 3 }) }}
          </span>
          <span
            class="inline-flex items-center gap-1.5 rounded-full bg-purple-100 px-2.5 py-1 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-purple-500"></span>
            stdio
          </span>
        </div>
      </div>
    </div>

    <!-- Usage mode -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-rocket-launch" class="h-4 w-4 text-blue-500" />
        {{ t('settings.mcp.mode.title') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between p-4">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.mcp.mode.label') }}
            </p>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {{ t(`settings.mcp.mode.${selectedMode}Desc`) }}
            </p>
          </div>
          <div class="w-64">
            <UTabs v-model="selectedMode" size="sm" class="gap-0" :items="modeOptions" />
          </div>
        </div>
        <template v-if="isDesktopMode">
          <div class="border-t border-gray-200 dark:border-gray-700" />
          <div class="flex items-center gap-3 p-4">
            <UIcon name="i-heroicons-clock" class="h-4 w-4 shrink-0 text-amber-500" />
            <p class="text-xs text-amber-600 dark:text-amber-400">
              {{ t('settings.mcp.mode.desktopComingSoon') }}
            </p>
          </div>
        </template>
      </div>
    </div>

    <!-- Config generation -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-clipboard-document" class="h-4 w-4 text-pink-500" />
        {{ t('settings.mcp.config.title') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
        <!-- Client selector -->
        <div class="flex items-center justify-between p-4">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.mcp.config.clientLabel') }}
            </p>
          </div>
          <div class="w-64">
            <UTabs v-model="selectedClient" size="sm" class="gap-0" :items="clientOptions" />
          </div>
        </div>

        <div class="border-t border-gray-200 dark:border-gray-700" />

        <!-- Generated config -->
        <div class="p-4">
          <div class="relative">
            <pre
              class="overflow-x-auto rounded-lg bg-gray-900 p-4 text-xs leading-relaxed text-gray-100 dark:bg-gray-950"
            ><code>{{ configJson }}</code></pre>
            <UButton
              :icon="copied ? 'i-heroicons-check' : 'i-heroicons-clipboard'"
              :color="copied ? 'success' : 'neutral'"
              variant="soft"
              size="xs"
              class="absolute right-2 top-2"
              @click="handleCopy"
            >
              {{ copied ? t('settings.mcp.config.copied') : t('settings.mcp.config.copy') }}
            </UButton>
          </div>

          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
            <template v-if="selectedClient === 'cursor'">
              {{ t('settings.mcp.config.cursorHint') }}
            </template>
            <template v-else-if="selectedClient === 'claude'">
              {{ t('settings.mcp.config.claudeHint') }}
            </template>
            <template v-else>
              {{ t('settings.mcp.config.otherHint') }}
            </template>
          </p>
        </div>
      </div>
    </div>

    <!-- Troubleshooting -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-light-bulb" class="h-4 w-4 text-amber-500" />
        {{ t('settings.mcp.tips.title') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <ul class="space-y-2 text-xs text-gray-600 dark:text-gray-400">
          <li class="flex items-start gap-2">
            <span class="mt-0.5 text-gray-400">•</span>
            {{ t('settings.mcp.tips.dataDir') }}
          </li>
          <li class="flex items-start gap-2">
            <span class="mt-0.5 text-gray-400">•</span>
            {{ t('settings.mcp.tips.readOnly') }}
          </li>
          <li class="flex items-start gap-2">
            <span class="mt-0.5 text-gray-400">•</span>
            {{ t('settings.mcp.tips.nodeRequired') }}
          </li>
          <li class="flex items-start gap-2">
            <span class="mt-0.5 text-gray-400">•</span>
            {{ t('settings.mcp.tips.docs') }}
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
