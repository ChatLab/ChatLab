<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useLLMStore, type AIServiceConfigDisplay } from '@/stores/llm'
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
const { configs, providers, activeConfigId, isLoading, isMaxConfigs } = storeToRefs(llmStore)

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

async function setActive(id: string) {
  const success = await llmStore.setActiveConfig(id)
  if (success) {
    emit('config-changed')
  }
}

function getProviderName(providerId: string): string {
  // Get localized provider name
  const key = `providers.${providerId}.name`
  const translated = t(key)
  if (translated !== key) {
    return translated
  }
  // Fallback to store method
  return llmStore.getProviderName(providerId)
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
  <div v-else class="space-y-4">
    <!-- 标题 -->
    <h4 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
      <UIcon name="i-heroicons-sparkles" class="h-4 w-4 text-violet-500" />
      {{ t('settings.aiConfig.title') }}
    </h4>
    <AlertTips v-if="configs.length === 0 && aiTips.configTab?.show" :content="aiTips.configTab?.content" />
    <!-- 配置列表 -->
    <div v-if="configs.length > 0" class="space-y-2">
      <div
        v-for="config in configs"
        :key="config.id"
        class="group flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors"
        :class="[
          config.id === activeConfigId
            ? 'border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-900/20'
            : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800',
        ]"
        @click="setActive(config.id)"
      >
        <!-- 配置信息 -->
        <div class="flex items-center gap-3">
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            :class="[
              config.id === activeConfigId
                ? 'bg-primary-500 text-white'
                : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
            ]"
          >
            <UIcon
              :name="config.id === activeConfigId ? 'i-heroicons-check' : 'i-heroicons-sparkles'"
              class="h-4 w-4"
            />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-medium text-gray-900 dark:text-white">{{ config.name }}</span>
              <UBadge v-if="config.id === activeConfigId" color="primary" variant="soft" size="xs">
                {{ t('settings.aiConfig.inUse') }}
              </UBadge>
            </div>
            <div class="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>{{ getProviderName(config.provider) }}</span>
              <span>·</span>
              <span>{{ config.model || t('settings.aiConfig.defaultModel') }}</span>
              <span v-if="config.baseUrl">·</span>
              <span v-if="config.baseUrl" class="text-violet-500">
                {{ t('settings.aiConfig.customEndpoint') }}
              </span>
            </div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100" @click.stop>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-heroicons-pencil-square"
            @click="openEditModal(config)"
          />
          <UButton size="xs" color="error" variant="ghost" icon="i-heroicons-trash" @click="deleteConfig(config.id)" />
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div
      v-else
      class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 py-12 dark:border-gray-700"
    >
      <UIcon name="i-heroicons-sparkles" class="h-12 w-12 text-gray-300 dark:text-gray-600" />
      <p class="mt-4 text-sm text-gray-500 dark:text-gray-400">{{ t('settings.aiConfig.empty.title') }}</p>
      <p class="text-xs text-gray-400 dark:text-gray-500">{{ t('settings.aiConfig.empty.description') }}</p>
    </div>

    <!-- 添加按钮 -->
    <div class="flex justify-center">
      <UButton variant="soft" :disabled="isMaxConfigs" class="mt-4" @click="openAddModal">
        <UIcon name="i-heroicons-plus" class="mr-2 h-4 w-4" />
        {{ isMaxConfigs ? t('settings.aiConfig.maxConfigs') : t('settings.aiConfig.addConfig') }}
      </UButton>
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
