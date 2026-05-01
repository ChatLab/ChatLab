<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useLLMStore, type AIServiceConfigDisplay } from '@/stores/llm'
import type { ProviderDefinition } from '@electron/preload/index'
import AIModelEditModal from './AIModelEditModal.vue'
import AlertTips from './AlertTips.vue'

const { t, locale } = useI18n()

// Emits
const emit = defineEmits<{
  'config-changed': []
}>()

const aiTips = computed(() => {
  const config = JSON.parse(
    localStorage.getItem(`chatlab_app_config_${locale.value}`) || localStorage.getItem('chatlab_app_config') || '{}'
  )
  return config.aiTips || {}
})

// ============ Store ============

const llmStore = useLLMStore()
const { configs, providers, providerRegistry, isLoading, isMaxConfigs } = storeToRefs(llmStore)

// 弹窗状态
const showEditModal = ref(false)
const editMode = ref<'add' | 'edit'>('add')
const editingConfig = ref<AIServiceConfigDisplay | null>(null)

// ============ 方法 ============

function openAddModal() {
  editMode.value = 'add'
  editingConfig.value = null
  showEditModal.value = true
}

function openEditModal(config: AIServiceConfigDisplay) {
  editMode.value = 'edit'
  editingConfig.value = config
  showEditModal.value = true
}

async function handleModalSaved() {
  await llmStore.refreshConfigs()
  emit('config-changed')
}

async function deleteConfig(id: string) {
  try {
    const result = await window.llmApi.deleteConfig(id)
    if (result.success) {
      await llmStore.refreshConfigs()
      emit('config-changed')
    } else {
      console.error('删除配置失败：', result.error)
    }
  } catch (error) {
    console.error('删除配置失败：', error)
  }
}

function getProviderName(providerId: string): string {
  const key = `providers.${providerId}.name`
  const translated = t(key)
  if (translated !== key) {
    return translated
  }
  return llmStore.getProviderName(providerId)
}

function getProviderKindLabel(providerId: string): string | null {
  const def = providerRegistry.value.find((p: ProviderDefinition) => p.id === providerId)
  if (!def || def.kind === 'official' || def.kind === 'openai-compatible') return null
  if (def.kind === 'aggregator') return t('settings.aiConfig.providerKind.aggregator')
  if (!def.builtin) return t('settings.aiConfig.providerKind.custom')
  return null
}

function getModelDisplayName(providerId: string, modelId?: string): string {
  if (!modelId) return t('settings.aiConfig.defaultModel')
  const model = llmStore.getModelById(providerId, modelId)
  return model?.name || modelId
}

// ============ 暴露方法 ============

function refresh() {
  llmStore.refreshConfigs()
}

defineExpose({ refresh })

onMounted(() => {
  // 如果 Store 未初始化，则初始化；否则刷新
  if (!llmStore.isInitialized) {
    llmStore.init()
  } else {
    llmStore.refreshConfigs()
  }
})
</script>

<template>
  <!-- 加载中 -->
  <div v-if="isLoading" class="flex items-center justify-center py-12">
    <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin text-gray-400" />
  </div>

  <!-- 配置列表视图 -->
  <div v-else class="space-y-6">
    <div>
      <h4 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-sparkles" class="h-4 w-4 text-violet-500" />
        {{ t('settings.aiConfig.title') }}
      </h4>
      <AlertTips v-if="configs.length === 0 && aiTips.configTab?.show" :content="aiTips.configTab?.content" />
      <div class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
        <!-- 配置列表 -->
        <div v-if="configs.length > 0" class="divide-y divide-gray-200 dark:divide-gray-700">
          <div
            v-for="config in configs"
            :key="config.id"
            class="group flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-gray-100/50 dark:hover:bg-gray-700/30"
          >
            <div class="flex items-center gap-3">
              <div
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
              >
                <UIcon name="i-heroicons-sparkles" class="h-3.5 w-3.5" />
              </div>
              <div class="flex min-w-0 items-center gap-2">
                <span class="w-28 shrink-0 truncate text-sm font-medium text-gray-900 dark:text-white">
                  {{ config.name }}
                </span>
                <span class="h-3.5 w-px shrink-0 bg-gray-200 dark:bg-gray-700" />
                <span class="flex min-w-0 items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <span class="truncate">{{ getProviderName(config.provider) }}</span>
                  <UBadge v-if="getProviderKindLabel(config.provider)" color="neutral" variant="subtle" size="xs">
                    {{ getProviderKindLabel(config.provider) }}
                  </UBadge>
                  <span class="shrink-0">·</span>
                  <span class="truncate">{{ getModelDisplayName(config.provider, config.model) }}</span>
                </span>
              </div>
            </div>

            <div class="flex items-center gap-1">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-heroicons-pencil-square"
                @click="openEditModal(config)"
              />
              <UButton
                size="xs"
                color="error"
                variant="ghost"
                icon="i-heroicons-trash"
                @click="deleteConfig(config.id)"
              />
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="flex flex-col items-center justify-center py-8">
          <UIcon name="i-heroicons-sparkles" class="h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">{{ t('settings.aiConfig.empty.title') }}</p>
          <p class="text-xs text-gray-400 dark:text-gray-500">{{ t('settings.aiConfig.empty.description') }}</p>
        </div>

        <!-- 添加按钮 -->
        <div class="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <UButton variant="soft" :disabled="isMaxConfigs" size="sm" @click="openAddModal">
            <UIcon name="i-heroicons-plus" class="mr-1.5 h-3.5 w-3.5" />
            {{ isMaxConfigs ? t('settings.aiConfig.maxConfigs') : t('settings.aiConfig.addConfig') }}
          </UButton>
        </div>
      </div>
    </div>
  </div>

  <!-- 编辑/添加弹窗 -->
  <AIModelEditModal
    v-model:open="showEditModal"
    :mode="editMode"
    :config="editingConfig"
    :providers="providers"
    @saved="handleModalSaved"
  />
</template>
