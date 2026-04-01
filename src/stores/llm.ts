import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

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
  createdAt: number
  updatedAt: number
}

/**
 * LLM 提供商信息
 */
export interface LLMProvider {
  id: string
  name: string
  description: string
  defaultBaseUrl: string
  models: Array<{ id: string; name: string; description?: string }>
}

/**
 * LLM 配置状态管理
 * 集中管理 LLM 配置的获取、切换和刷新
 */
export const useLLMStore = defineStore('llm', () => {
  // ============ 状态 ============

  /** 所有配置列表 */
  const configs = ref<AIServiceConfigDisplay[]>([])

  /** 所有提供商列表 */
  const providers = ref<LLMProvider[]>([])

  /** 当前激活配置 ID */
  const activeConfigId = ref<string | null>(null)

  /** 是否正在加载 */
  const isLoading = ref(false)

  /** 是否已初始化 */
  const isInitialized = ref(false)

  // ============ 计算属性 ============

  /** 当前激活的配置 */
  const activeConfig = computed(() => configs.value.find((c) => c.id === activeConfigId.value) || null)

  /** 是否有可用配置 */
  const hasConfig = computed(() => !!activeConfigId.value)

  /** 是否达到最大配置数量 */
  const isMaxConfigs = computed(() => configs.value.length >= 99)

  // ============ 方法 ============

  /**
   * 初始化加载配置（仅首次调用生效）
   */
  async function init() {
    if (isInitialized.value) return
    await loadConfigs()
    isInitialized.value = true
  }

  /**
   * 加载所有配置和提供商
   */
  async function loadConfigs() {
    isLoading.value = true
    try {
      const [providersData, configsData, activeId] = await Promise.all([
        window.llmApi.getProviders(),
        window.llmApi.getAllConfigs(),
        window.llmApi.getActiveConfigId(),
      ])
      providers.value = providersData
      configs.value = configsData
      activeConfigId.value = activeId
    } catch (error) {
      console.error('[LLM Store] 加载配置失败：', error)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 切换激活配置
   * @param id 配置 ID
   * @returns 是否成功
   */
  async function setActiveConfig(id: string): Promise<boolean> {
    try {
      const result = await window.llmApi.setActiveConfig(id)
      if (result.success) {
        activeConfigId.value = id
        return true
      }
      console.error('[LLM Store] 设置激活配置失败：', result.error)
      return false
    } catch (error) {
      console.error('[LLM Store] 设置激活配置失败：', error)
      return false
    }
  }

  /**
   * 刷新配置列表
   * 供外部（如设置页面修改后）调用
   */
  async function refreshConfigs() {
    await loadConfigs()
  }

  /**
   * 获取提供商名称
   * @param providerId 提供商 ID
   * @returns 提供商名称
   */
  function getProviderName(providerId: string): string {
    return providers.value.find((p) => p.id === providerId)?.name || providerId
  }

  return {
    // 状态
    configs,
    providers,
    activeConfigId,
    isLoading,
    isInitialized,
    // 计算属性
    activeConfig,
    hasConfig,
    isMaxConfigs,
    // 方法
    init,
    loadConfigs,
    setActiveConfig,
    refreshConfigs,
    getProviderName,
  }
})
