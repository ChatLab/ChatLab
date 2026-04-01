import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { EmbeddingServiceConfigDisplay } from '@electron/preload/index'

/**
 * Embedding 配置状态管理
 * 集中管理 Embedding 配置的获取、切换和刷新
 */
export const useEmbeddingStore = defineStore('embedding', () => {
  // ============ 状态 ============

  /** 所有配置列表 */
  const configs = ref<EmbeddingServiceConfigDisplay[]>([])

  /** 当前激活配置 ID */
  const activeConfigId = ref<string | null>(null)

  /** 是否正在加载 */
  const isLoading = ref(false)

  /** 是否已初始化 */
  const isInitialized = ref(false)

  /** 向量存储统计 */
  const vectorStoreStats = ref<{
    enabled: boolean
    count?: number
    sizeBytes?: number
  }>({ enabled: false })

  // ============ 计算属性 ============

  /** 当前激活的配置 */
  const activeConfig = computed(() => configs.value.find((c) => c.id === activeConfigId.value) || null)

  /** 是否有可用配置 */
  const hasConfig = computed(() => configs.value.length > 0)

  /** 是否达到最大配置数量 */
  const isMaxConfigs = computed(() => configs.value.length >= 10)

  /** 格式化的存储大小 */
  const vectorStoreSizeFormatted = computed(() => {
    const bytes = vectorStoreStats.value.sizeBytes ?? 0
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  })

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
   * 加载所有配置
   */
  async function loadConfigs() {
    isLoading.value = true
    try {
      const [configsData, activeId, stats] = await Promise.all([
        window.embeddingApi.getAllConfigs(),
        window.embeddingApi.getActiveConfigId(),
        window.embeddingApi.getVectorStoreStats(),
      ])
      configs.value = configsData
      activeConfigId.value = activeId
      vectorStoreStats.value = stats
    } catch (error) {
      console.error('[Embedding Store] 加载配置失败：', error)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 切换激活配置
   */
  async function setActiveConfig(id: string): Promise<boolean> {
    try {
      const result = await window.embeddingApi.setActiveConfig(id)
      if (result.success) {
        activeConfigId.value = id
        return true
      }
      console.error('[Embedding Store] 设置激活配置失败：', result.error)
      return false
    } catch (error) {
      console.error('[Embedding Store] 设置激活配置失败：', error)
      return false
    }
  }

  /**
   * 删除配置
   */
  async function deleteConfig(id: string): Promise<boolean> {
    try {
      const result = await window.embeddingApi.deleteConfig(id)
      if (result.success) {
        await loadConfigs()
        return true
      }
      console.error('[Embedding Store] 删除配置失败：', result.error)
      return false
    } catch (error) {
      console.error('[Embedding Store] 删除配置失败：', error)
      return false
    }
  }

  /**
   * 清空向量存储
   */
  async function clearVectorStore(): Promise<boolean> {
    try {
      const result = await window.embeddingApi.clearVectorStore()
      if (result.success) {
        vectorStoreStats.value.count = 0
        vectorStoreStats.value.sizeBytes = 0
        return true
      }
      console.error('[Embedding Store] 清空向量存储失败：', result.error)
      return false
    } catch (error) {
      console.error('[Embedding Store] 清空向量存储失败：', error)
      return false
    }
  }

  /**
   * 刷新配置列表
   */
  async function refreshConfigs() {
    await loadConfigs()
  }

  return {
    // 状态
    configs,
    activeConfigId,
    isLoading,
    isInitialized,
    vectorStoreStats,
    // 计算属性
    activeConfig,
    hasConfig,
    isMaxConfigs,
    vectorStoreSizeFormatted,
    // 方法
    init,
    loadConfigs,
    setActiveConfig,
    deleteConfig,
    clearVectorStore,
    refreshConfigs,
  }
})
