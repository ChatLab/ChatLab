import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ProviderDefinition, ModelDefinition } from '@electron/preload/index'

/**
 * LLM 服务配置（展示用，不含敏感信息）
 */
export interface AIServiceConfigDisplay {
  id: string
  name: string
  provider: string
  apiKeySet: boolean
  model?: string
  baseUrl?: string
  customModels?: Array<{ id: string; name: string }>
  createdAt: number
  updatedAt: number
}

export interface LLMProvider {
  id: string
  name: string
  defaultBaseUrl: string
  models: Array<{ id: string; name: string; description?: string }>
}

export const useLLMStore = defineStore('llm', () => {
  // ============ 状态 ============

  const configs = ref<AIServiceConfigDisplay[]>([])
  const providers = ref<LLMProvider[]>([])

  const defaultAssistant = ref<{ configId: string; modelId: string } | null>(null)
  const fastModel = ref<{ configId: string; modelId: string } | null>(null)
  const isLoading = ref(false)
  const isInitialized = ref(false)

  const providerRegistry = ref<ProviderDefinition[]>([])
  const modelCatalog = ref<ModelDefinition[]>([])

  // ============ 计算属性 ============

  const defaultAssistantConfig = computed(
    () => configs.value.find((c) => c.id === defaultAssistant.value?.configId) || null
  )
  const fastModelConfig = computed(() => configs.value.find((c) => c.id === fastModel.value?.configId) || null)
  const hasConfig = computed(() => !!defaultAssistant.value)
  const isMaxConfigs = computed(() => configs.value.length >= 99)

  function getProviderById(id: string): ProviderDefinition | undefined {
    return providerRegistry.value.find((p) => p.id === id)
  }

  function getModelsByProviderId(providerId: string): ModelDefinition[] {
    return modelCatalog.value.filter((m) => m.providerId === providerId)
  }

  function getModelById(providerId: string, modelId: string): ModelDefinition | undefined {
    return modelCatalog.value.find((m) => m.providerId === providerId && m.id === modelId)
  }

  function findModelAcrossProviders(modelId: string): ModelDefinition | undefined {
    return modelCatalog.value.find((m) => m.id === modelId)
  }

  // ============ 方法 ============

  async function init() {
    if (isInitialized.value) return
    await loadConfigs()
    isInitialized.value = true
  }

  async function loadConfigs() {
    isLoading.value = true
    try {
      const [providersData, registryData, catalogData, configsData, assistantSlot, fastSlot] = await Promise.all([
        window.llmApi.getProviders(),
        window.llmApi.getProviderRegistry(),
        window.llmApi.getModelCatalog(),
        window.llmApi.getAllConfigs(),
        window.llmApi.getDefaultAssistantSlot(),
        window.llmApi.getFastModelSlot(),
      ])
      providers.value = providersData
      providerRegistry.value = registryData
      modelCatalog.value = catalogData
      configs.value = configsData
      defaultAssistant.value = assistantSlot
      fastModel.value = fastSlot
    } catch (error) {
      console.error('[LLM Store] 加载配置失败：', error)
    } finally {
      isLoading.value = false
    }
  }

  async function setDefaultAssistantModel(configId: string, modelId: string): Promise<boolean> {
    try {
      const result = await window.llmApi.setDefaultAssistantModel(configId, modelId)
      if (result.success) {
        defaultAssistant.value = { configId, modelId }
        return true
      }
      console.error('[LLM Store] 设置默认助手模型失败：', result.error)
      return false
    } catch (error) {
      console.error('[LLM Store] 设置默认助手模型失败：', error)
      return false
    }
  }

  async function setFastModel(slot: { configId: string; modelId: string } | null): Promise<boolean> {
    try {
      const result = await window.llmApi.setFastModel(slot)
      if (result.success) {
        fastModel.value = slot
        return true
      }
      console.error('[LLM Store] 设置快速模型失败：', result.error)
      return false
    } catch (error) {
      console.error('[LLM Store] 设置快速模型失败：', error)
      return false
    }
  }

  async function refreshConfigs() {
    await loadConfigs()
  }

  function getProviderName(providerId: string): string {
    const def = providerRegistry.value.find((p) => p.id === providerId)
    if (def) return def.name
    return providers.value.find((p) => p.id === providerId)?.name || providerId
  }

  return {
    // 状态
    configs,
    providers,
    providerRegistry,
    modelCatalog,
    defaultAssistant,
    fastModel,
    isLoading,
    isInitialized,
    // 计算属性
    defaultAssistantConfig,
    fastModelConfig,
    hasConfig,
    isMaxConfigs,
    // 方法
    init,
    loadConfigs,
    setDefaultAssistantModel,
    setFastModel,
    refreshConfigs,
    getProviderName,
    getProviderById,
    getModelsByProviderId,
    getModelById,
    findModelAcrossProviders,
  }
})
