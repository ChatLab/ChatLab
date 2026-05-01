<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useLLMStore } from '@/stores/llm'

const { t } = useI18n()

const emit = defineEmits<{
  'config-changed': []
}>()

const llmStore = useLLMStore()
const { configs, defaultAssistant, fastModel, modelCatalog } = storeToRefs(llmStore)

function getModelsForConfig(configId: string) {
  const config = configs.value.find((c) => c.id === configId)
  if (!config) return []

  if (config.customModels && config.customModels.length > 0) {
    return config.customModels.map((m) => ({ label: m.name || m.id, value: m.id }))
  }

  const models = modelCatalog.value.filter(
    (m) =>
      m.providerId === config.provider && !m.capabilities.includes('embedding') && !m.capabilities.includes('ranking')
  )
  const options = models.map((m) => ({ label: m.name || m.id, value: m.id }))

  if (config.model && !options.some((o) => o.value === config.model)) {
    options.unshift({ label: config.model, value: config.model })
  }

  return options
}

const configOptions = computed(() =>
  configs.value.map((c) => ({
    label: c.name,
    value: c.id,
  }))
)

// ========== 助手模型 ==========

const assistantModelOptions = computed(() => {
  const id = defaultAssistant.value?.configId
  return id ? getModelsForConfig(id) : []
})

const internalAssistantConfigId = computed({
  get: () => defaultAssistant.value?.configId ?? '',
  set: (val: string) => {
    if (!val) return
    const models = getModelsForConfig(val)
    const modelId = models[0]?.value ?? ''
    llmStore.setDefaultAssistantModel(val, modelId)
    emit('config-changed')
  },
})

const internalAssistantModelId = computed({
  get: () => defaultAssistant.value?.modelId ?? '',
  set: (val: string) => {
    const configId = defaultAssistant.value?.configId
    if (configId && val) {
      llmStore.setDefaultAssistantModel(configId, val)
      emit('config-changed')
    }
  },
})

// ========== 快速模型 ==========

const FOLLOW_VALUE = '__follow__'

const fastConfigSelectOptions = computed(() => [
  { label: t('settings.defaultModel.fastModel.followAssistant'), value: FOLLOW_VALUE },
  ...configOptions.value,
])

const fastModelOptions = computed(() => {
  const id = fastModel.value?.configId
  return id ? getModelsForConfig(id) : []
})

const showFastModelSelector = computed(() => fastModel.value !== null)

const internalFastConfigId = computed({
  get: () => fastModel.value?.configId ?? FOLLOW_VALUE,
  set: (val: string) => {
    if (val === FOLLOW_VALUE) {
      llmStore.setFastModel(null)
    } else {
      const models = getModelsForConfig(val)
      const modelId = models[0]?.value ?? ''
      llmStore.setFastModel({ configId: val, modelId })
    }
    emit('config-changed')
  },
})

const internalFastModelId = computed({
  get: () => fastModel.value?.modelId ?? '',
  set: (val: string) => {
    const configId = fastModel.value?.configId
    if (configId && val) {
      llmStore.setFastModel({ configId, modelId: val })
      emit('config-changed')
    }
  },
})

onMounted(() => {
  if (!llmStore.isInitialized) {
    llmStore.init()
  }
})
</script>

<template>
  <div class="space-y-6">
    <div
      v-if="configs.length === 0"
      class="rounded-lg border-2 border-dashed border-gray-200 py-8 text-center dark:border-gray-700"
    >
      <UIcon name="i-heroicons-cpu-chip" class="mx-auto mb-2 h-8 w-8 text-gray-300 dark:text-gray-600" />
      <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('settings.defaultModel.noConfigs') }}</p>
    </div>

    <div v-else>
      <h4 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-cpu-chip" class="h-4 w-4 text-violet-500" />
        {{ t('settings.defaultModel.title') }}
      </h4>
      <div class="space-y-5 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <!-- 默认助手模型 -->
        <div>
          <div class="mb-2">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.defaultModel.assistantModel.label') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.defaultModel.assistantModel.description') }}
            </p>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex-1">
              <span class="mb-1 block text-xs text-gray-400 dark:text-gray-500">
                {{ t('settings.defaultModel.selectProvider') }}
              </span>
              <USelect
                v-model="internalAssistantConfigId"
                :items="configOptions"
                :ui="{ content: 'z-[200]' }"
                class="w-full"
                size="sm"
              />
            </div>
            <div class="flex-1">
              <span class="mb-1 block text-xs text-gray-400 dark:text-gray-500">
                {{ t('settings.defaultModel.selectModel') }}
              </span>
              <USelect
                v-if="assistantModelOptions.length > 0"
                v-model="internalAssistantModelId"
                :items="assistantModelOptions"
                :ui="{ content: 'z-[200]' }"
                class="w-full"
                size="sm"
              />
              <USelect v-else :items="[]" disabled class="w-full" size="sm" />
            </div>
          </div>
        </div>

        <!-- 分隔线 -->
        <div class="border-t border-gray-200 dark:border-gray-700" />

        <!-- 快速模型 -->
        <div>
          <div class="mb-2">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.defaultModel.fastModel.label') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.defaultModel.fastModel.description') }}
            </p>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex-1">
              <span class="mb-1 block text-xs text-gray-400 dark:text-gray-500">
                {{ t('settings.defaultModel.selectProvider') }}
              </span>
              <USelect
                v-model="internalFastConfigId"
                :items="fastConfigSelectOptions"
                :ui="{ content: 'z-[200]' }"
                class="w-full"
                size="sm"
              />
            </div>
            <div class="flex-1">
              <span class="mb-1 block text-xs text-gray-400 dark:text-gray-500">
                {{ t('settings.defaultModel.selectModel') }}
              </span>
              <USelect
                v-if="showFastModelSelector && fastModelOptions.length > 0"
                v-model="internalFastModelId"
                :items="fastModelOptions"
                :ui="{ content: 'z-[200]' }"
                class="w-full"
                size="sm"
              />
              <USelect v-else :items="[]" disabled class="w-full" size="sm" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
