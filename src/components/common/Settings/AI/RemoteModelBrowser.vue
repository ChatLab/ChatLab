<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const open = defineModel<boolean>('open', { required: true })

interface RemoteModel {
  id: string
  name: string
  ownedBy?: string
  contextWindow?: number
}

const props = defineProps<{
  models: RemoteModel[]
  loading: boolean
  error: string
  addedModelIds: Set<string>
}>()

const emit = defineEmits<{
  add: [model: RemoteModel]
  addAll: [models: RemoteModel[]]
  refresh: []
}>()

const searchQuery = ref('')

const filteredModels = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return props.models
  return props.models.filter(
    (m) =>
      m.id.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      (m.ownedBy && m.ownedBy.toLowerCase().includes(q))
  )
})

const unaddedFilteredModels = computed(() => filteredModels.value.filter((m) => !props.addedModelIds.has(m.id)))

function handleAddAll() {
  emit('addAll', unaddedFilteredModels.value)
}
</script>

<template>
  <UModal :open="open" :ui="{ content: 'max-w-2xl z-[102]', overlay: 'z-[101]' }" @update:open="open = $event">
    <template #content>
      <div class="flex max-h-[80vh] min-h-[400px] flex-col p-6">
        <!-- 标题 -->
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ t('settings.aiConfig.modal.fetchModelsTitle') }}
          </h3>
          <div class="flex items-center gap-2">
            <UButton
              v-if="filteredModels.length > 0 && unaddedFilteredModels.length > 0"
              size="xs"
              variant="soft"
              @click="handleAddAll"
            >
              <UIcon name="i-heroicons-plus" class="h-3.5 w-3.5" />
              {{ t('settings.aiConfig.modal.addAllModels') }} ({{ unaddedFilteredModels.length }})
            </UButton>
            <UButton size="xs" variant="ghost" :loading="loading" @click="emit('refresh')">
              <UIcon name="i-heroicons-arrow-path" class="h-4 w-4" />
            </UButton>
          </div>
        </div>

        <!-- 搜索框 -->
        <UInput
          v-model="searchQuery"
          :placeholder="t('settings.aiConfig.modal.searchModels')"
          class="mb-3"
          :ui="{ leading: 'pointer-events-none' }"
        >
          <template #leading>
            <UIcon name="i-heroicons-magnifying-glass" class="h-4 w-4 text-gray-400" />
          </template>
        </UInput>

        <!-- 内容区域 -->
        <div class="min-h-0 flex-1 overflow-y-auto">
          <!-- 加载中 -->
          <div v-if="loading" class="flex flex-col items-center justify-center py-12">
            <UIcon name="i-heroicons-arrow-path" class="mb-3 h-8 w-8 animate-spin text-gray-400" />
            <p class="text-sm text-gray-500">{{ t('settings.aiConfig.modal.fetchModelsLoading') }}</p>
          </div>

          <!-- 错误 -->
          <div v-else-if="error" class="flex flex-col items-center justify-center py-12">
            <UIcon name="i-heroicons-exclamation-triangle" class="mb-3 h-8 w-8 text-amber-400" />
            <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.aiConfig.modal.fetchModelsError') }}
            </p>
            <p class="mt-1 max-w-sm text-center text-xs text-gray-500">{{ error }}</p>
            <UButton size="xs" variant="soft" class="mt-3" @click="emit('refresh')">
              {{ t('common.retry') }}
            </UButton>
          </div>

          <!-- 空状态 -->
          <div v-else-if="filteredModels.length === 0" class="flex flex-col items-center justify-center py-12">
            <UIcon name="i-heroicons-cube-transparent" class="mb-3 h-8 w-8 text-gray-300" />
            <p class="text-sm text-gray-500">
              {{ searchQuery ? t('common.noResults') : t('settings.aiConfig.modal.fetchModelsEmpty') }}
            </p>
          </div>

          <!-- 模型列表 -->
          <div v-else class="space-y-1">
            <div
              v-for="model in filteredModels"
              :key="model.id"
              class="flex items-center justify-between rounded-lg px-3 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
                  {{ model.id }}
                </p>
                <div class="flex items-center gap-2">
                  <span v-if="model.ownedBy" class="truncate text-xs text-gray-400">
                    {{ model.ownedBy }}
                  </span>
                  <span
                    v-if="model.contextWindow"
                    class="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                  >
                    {{
                      model.contextWindow >= 1000000
                        ? (model.contextWindow / 1048576).toFixed(1) + 'M'
                        : Math.round(model.contextWindow / 1024) + 'K'
                    }}
                  </span>
                </div>
              </div>
              <button
                v-if="addedModelIds.has(model.id)"
                disabled
                class="ml-3 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-green-500"
              >
                <UIcon name="i-heroicons-check" class="h-3.5 w-3.5" />
                {{ t('settings.aiConfig.modal.modelAdded') }}
              </button>
              <UButton v-else size="xs" variant="soft" class="ml-3 shrink-0" @click="emit('add', model)">
                <UIcon name="i-heroicons-plus" class="h-3.5 w-3.5" />
                {{ t('common.add') }}
              </UButton>
            </div>
          </div>
        </div>

        <!-- 底部统计 + 关闭 -->
        <div class="mt-4 flex items-center justify-between border-t border-gray-100 pt-4 dark:border-gray-800">
          <p class="text-xs text-gray-400">
            {{ t('settings.aiConfig.modal.fetchModelsCount', { total: models.length, shown: filteredModels.length }) }}
          </p>
          <UButton variant="soft" @click="open = false">{{ t('common.close') }}</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
