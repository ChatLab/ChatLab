<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useClipboard } from '@vueuse/core'

const { t } = useI18n()
const { copy, copied } = useClipboard({ copiedDuring: 2000 })

type McpClient = 'claude' | 'codex' | 'openclaw' | 'other'

const selectedClient = ref<McpClient>('claude')

const clientOptions = computed(() => [
  { label: 'Claude', value: 'claude' },
  { label: 'Codex', value: 'codex' },
  { label: 'OpenClaw', value: 'openclaw' },
  { label: t('settings.mcp.clients.other'), value: 'other' },
])

const configText = computed(() => {
  const command = 'chatlab'
  const args = ['mcp']
  switch (selectedClient.value) {
    case 'codex':
      return ['[mcp_servers.chatlab]', `command = "${command}"`, `args = ["${args[0]}"]`].join('\n')
    case 'openclaw':
      return JSON.stringify({ mcp: { servers: { chatlab: { command, args } } } }, null, 2)
    case 'claude':
      return JSON.stringify({ mcpServers: { chatlab: { command, args } } }, null, 2)
    default:
      return JSON.stringify({ command, args }, null, 2)
  }
})

function handleCopy() {
  copy(configText.value)
}
</script>

<template>
  <div class="space-y-6 pb-6">
    <!-- MCP Overview + Install -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-command-line" class="h-4 w-4 text-emerald-500" />
        {{ t('settings.mcp.overview.title') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="p-4">
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
        <div class="border-t border-gray-200 dark:border-gray-700" />
        <div class="p-4">
          <p class="text-sm text-gray-600 dark:text-gray-300">
            {{ t('settings.mcp.overview.installHint') }}
          </p>
          <div class="mt-2">
            <code class="inline-block rounded-md bg-gray-900 px-3 py-1.5 text-xs text-gray-100 dark:bg-gray-950">
              npm install -g chatlab-cli
            </code>
          </div>
        </div>
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
          <div class="w-72">
            <UTabs v-model="selectedClient" size="sm" class="gap-0" :items="clientOptions" />
          </div>
        </div>

        <div class="border-t border-gray-200 dark:border-gray-700" />

        <!-- Generated config -->
        <div class="p-4">
          <div class="relative">
            <pre
              class="overflow-x-auto rounded-lg bg-gray-900 p-4 text-xs leading-relaxed text-gray-100 dark:bg-gray-950"
            ><code>{{ configText }}</code></pre>
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
            {{ t(`settings.mcp.config.${selectedClient}Hint`) }}
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
