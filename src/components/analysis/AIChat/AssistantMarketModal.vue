<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useAssistantStore, type BuiltinAssistantInfo } from '@/stores/assistant'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  configure: [id: string]
  'view-config': [id: string]
  create: []
}>()

const assistantStore = useAssistantStore()
const { assistants, builtinCatalog } = storeToRefs(assistantStore)

const activeTab = ref<'local' | 'market'>('local')

const sortedAssistants = computed(() => {
  return [...assistants.value].sort((a, b) => {
    const orderDiff = (a.order ?? 100) - (b.order ?? 100)
    if (orderDiff !== 0) return orderDiff
    return a.name.localeCompare(b.name)
  })
})

const sortedCatalog = computed(() => {
  return [...builtinCatalog.value].sort((a, b) => {
    const orderDiff = (a.order ?? 100) - (b.order ?? 100)
    if (orderDiff !== 0) return orderDiff
    return a.name.localeCompare(b.name)
  })
})

const importing = new Set<string>()

onMounted(() => {
  assistantStore.loadBuiltinCatalog()
})

function isGeneral(id: string): boolean {
  return id === 'general'
}

function handleConfigure(id: string) {
  emit('configure', id)
}

async function handleDelete(id: string) {
  if (isGeneral(id)) return
  await assistantStore.deleteAssistant(id)
}

async function handleDuplicate(id: string) {
  await assistantStore.duplicateAssistant(id)
}

function handleCreate() {
  emit('create')
}

async function handleImport(builtinId: string) {
  if (importing.has(builtinId)) return
  importing.add(builtinId)
  try {
    await assistantStore.importAssistant(builtinId)
  } finally {
    importing.delete(builtinId)
  }
}

async function handleReimport(item: BuiltinAssistantInfo) {
  const userAssistant = assistantStore.assistants.find((a) => a.builtinId === item.id)
  if (!userAssistant) return
  await assistantStore.reimportAssistant(userAssistant.id)
}

function handleViewConfig(builtinId: string) {
  const userAssistant = assistantStore.assistants.find((a) => a.builtinId === builtinId)
  if (userAssistant) {
    emit('view-config', userAssistant.id)
  }
}

function getChatTypeLabel(types?: ('group' | 'private')[]): string | null {
  if (!types?.length) return null
  const labels = types.map((ct) =>
    ct === 'group' ? t('ai.assistant.config.chatTypeGroup') : t('ai.assistant.config.chatTypePrivate')
  )
  return labels.join(' / ')
}
</script>

<template>
  <UModal :open="open" :ui="{ content: 'sm:max-w-xl z-50' }" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="p-6">
        <!-- 标题 -->
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100">{{ t('ai.assistant.market.title') }}</h2>
          <button
            class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            @click="emit('update:open', false)"
          >
            <UIcon name="i-heroicons-x-mark" class="h-5 w-5" />
          </button>
        </div>

        <!-- Tab 切换 -->
        <div class="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
          <button
            class="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            :class="
              activeTab === 'local'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
            "
            @click="activeTab = 'local'"
          >
            {{ t('ai.assistant.market.tabs.local') }}
            <span
              v-if="assistants.length"
              class="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-100 px-1 text-[10px] text-primary-600 dark:bg-primary-900/30 dark:text-primary-400"
            >
              {{ assistants.length }}
            </span>
          </button>
          <button
            class="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            :class="
              activeTab === 'market'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
            "
            @click="activeTab = 'market'"
          >
            {{ t('ai.assistant.market.tabs.market') }}
          </button>
        </div>

        <!-- 本地助手 Tab -->
        <div v-show="activeTab === 'local'">
          <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">{{ t('ai.assistant.market.localHint') }}</p>
          <div class="max-h-[400px] space-y-3 overflow-y-auto pr-1">
            <div
              v-for="assistant in sortedAssistants"
              :key="assistant.id"
              class="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 transition-colors dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {{ assistant.name }}
                  </h3>
                  <span
                    v-if="getChatTypeLabel(assistant.applicableChatTypes)"
                    class="inline-flex shrink-0 items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                  >
                    {{ getChatTypeLabel(assistant.applicableChatTypes) }}
                  </span>
                  <span
                    v-if="isGeneral(assistant.id)"
                    class="inline-flex shrink-0 items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  >
                    {{ t('ai.assistant.market.default') }}
                  </span>
                </div>
                <p class="mt-1 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
                  {{ assistant.systemPrompt }}
                </p>
              </div>

              <div class="flex shrink-0 items-center gap-1.5">
                <button
                  class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                  :title="t('common.edit')"
                  @click.stop="handleConfigure(assistant.id)"
                >
                  <UIcon name="i-heroicons-pencil-square" class="h-4 w-4" />
                </button>
                <button
                  class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                  :title="t('ai.assistant.market.duplicate')"
                  @click.stop="handleDuplicate(assistant.id)"
                >
                  <UIcon name="i-heroicons-document-duplicate" class="h-4 w-4" />
                </button>
                <button
                  v-if="!isGeneral(assistant.id)"
                  class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                  :title="t('common.delete')"
                  @click.stop="handleDelete(assistant.id)"
                >
                  <UIcon name="i-heroicons-trash" class="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <!-- 新增助手按钮 -->
          <button
            type="button"
            class="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gray-300 py-4 text-sm text-gray-500 transition-colors hover:border-primary-400 hover:text-primary-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-primary-500 dark:hover:text-primary-400"
            @click="handleCreate"
          >
            <UIcon name="i-heroicons-plus" class="h-4 w-4" />
            {{ t('ai.assistant.market.addAssistant') }}
          </button>

          <div v-if="sortedAssistants.length === 0" class="py-12 text-center text-sm text-gray-400">
            {{ t('ai.assistant.market.noLocal') }}
          </div>
        </div>

        <!-- 助手市场 Tab -->
        <div v-show="activeTab === 'market'">
          <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">{{ t('ai.assistant.market.marketHint') }}</p>
          <div class="max-h-[400px] space-y-3 overflow-y-auto pr-1">
            <div
              v-for="item in sortedCatalog"
              :key="item.id"
              class="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 transition-colors dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {{ item.name }}
                  </h3>
                  <span
                    v-if="getChatTypeLabel(item.applicableChatTypes)"
                    class="inline-flex shrink-0 items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                  >
                    {{ getChatTypeLabel(item.applicableChatTypes) }}
                  </span>
                  <span
                    v-if="isGeneral(item.id)"
                    class="inline-flex shrink-0 items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  >
                    {{ t('ai.assistant.market.default') }}
                  </span>
                  <span
                    v-if="item.imported && item.hasUpdate"
                    class="inline-flex shrink-0 items-center rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                  >
                    {{ t('ai.assistant.market.updateAvailable') }}
                  </span>
                </div>
                <p class="mt-1 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
                  {{ item.systemPrompt }}
                </p>
              </div>

              <div class="flex shrink-0 items-center gap-2">
                <button
                  v-if="item.imported && item.hasUpdate"
                  class="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-orange-600"
                  @click="handleReimport(item)"
                >
                  {{ t('ai.assistant.market.reimport') }}
                </button>

                <span
                  v-else-if="item.imported"
                  class="px-3 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-500"
                >
                  {{ t('ai.assistant.market.imported') }}
                </span>

                <button
                  v-else
                  class="rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-600"
                  @click="handleImport(item.id)"
                >
                  {{ t('ai.assistant.market.import') }}
                </button>

                <button
                  v-if="item.imported"
                  class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                  :title="t('ai.assistant.market.viewConfig')"
                  @click.stop="handleViewConfig(item.id)"
                >
                  <UIcon name="i-heroicons-eye" class="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div v-if="sortedCatalog.length === 0" class="py-12 text-center text-sm text-gray-400">
            {{ t('ai.assistant.market.noCatalog') }}
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
