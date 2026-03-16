/**
 * 助手管理 Store
 * 管理助手列表缓存、当前选中助手、配置 CRUD、云端市场
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { i18n } from '@/i18n'

const CLOUD_MARKET_BASE_URL = 'https://chatlab.fun'
const LOCALE_PATH_MAP: Record<string, string> = { 'zh-CN': 'cn', 'zh-TW': 'cn', 'en-US': 'en', 'ja-JP': 'ja' }

export interface AssistantSummary {
  id: string
  name: string
  systemPrompt: string
  presetQuestions: string[]
  builtinId?: string
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
}

export interface AssistantConfigFull {
  id: string
  name: string
  systemPrompt: string
  presetQuestions: string[]
  allowedBuiltinTools?: string[]
  builtinId?: string
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
}

export interface BuiltinAssistantInfo {
  id: string
  name: string
  systemPrompt: string
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
  imported: boolean
}

export interface CloudAssistantItem {
  id: string
  name: string
  description: string
  applicableChatTypes: ('group' | 'private')[]
  path: string
}

export const useAssistantStore = defineStore('assistant', () => {
  const assistants = ref<AssistantSummary[]>([])
  const selectedAssistantId = ref<string | null>(null)
  const isLoaded = ref(false)

  /** @deprecated 本地内置目录已清空，保留兼容 */
  const builtinCatalog = ref<BuiltinAssistantInfo[]>([])

  /** 内置 TS 工具名称列表 */
  const builtinTsToolNames = ref<string[]>([])

  /** 云端市场目录 */
  const cloudCatalog = ref<CloudAssistantItem[]>([])
  const cloudLoading = ref(false)
  const cloudError = ref<string | null>(null)

  /** 当前过滤条件 */
  const currentChatType = ref<'group' | 'private'>('group')
  const currentLocale = ref<string>('zh-CN')

  const selectedAssistant = computed(() => {
    if (!selectedAssistantId.value) return null
    return assistants.value.find((a) => a.id === selectedAssistantId.value) ?? null
  })

  const filteredAssistants = computed(() => {
    return assistants.value.filter((a) => {
      const typeMatch = !a.applicableChatTypes?.length || a.applicableChatTypes.includes(currentChatType.value)
      const localeMatch =
        !a.supportedLocales?.length || a.supportedLocales.some((l) => currentLocale.value.startsWith(l))
      return typeMatch && localeMatch
    })
  })

  const defaultVisibleCount = 4

  const defaultAssistants = computed(() => filteredAssistants.value.slice(0, defaultVisibleCount))

  const moreAssistants = computed(() => filteredAssistants.value.slice(defaultVisibleCount))

  const hasMoreAssistants = computed(() => filteredAssistants.value.length > defaultVisibleCount)

  /** 云端目录中标注导入状态 */
  const cloudCatalogWithStatus = computed(() => {
    const localIds = new Set(assistants.value.map((a) => a.id))
    return cloudCatalog.value.map((item) => ({
      ...item,
      imported: localIds.has(item.id),
    }))
  })

  function setFilterContext(chatType: 'group' | 'private', locale: string): void {
    currentChatType.value = chatType
    currentLocale.value = locale
  }

  async function loadAssistants(): Promise<void> {
    try {
      assistants.value = await window.assistantApi.getAll()
      isLoaded.value = true
    } catch (error) {
      console.error('[AssistantStore] Failed to load assistants:', error)
    }
  }

  /** @deprecated 本地内置目录已清空，保留兼容 */
  async function loadBuiltinCatalog(): Promise<void> {
    try {
      builtinCatalog.value = await window.assistantApi.getBuiltinCatalog()
    } catch (error) {
      console.error('[AssistantStore] Failed to load builtin catalog:', error)
    }
  }

  async function loadBuiltinTsToolNames(): Promise<void> {
    try {
      builtinTsToolNames.value = await window.assistantApi.getBuiltinTsToolNames()
    } catch (error) {
      console.error('[AssistantStore] Failed to load builtin ts tool names:', error)
    }
  }

  // ==================== 云端市场 ====================

  async function fetchCloudCatalog(): Promise<void> {
    const langPath = LOCALE_PATH_MAP[currentLocale.value] ?? 'en'
    const url = `${CLOUD_MARKET_BASE_URL}/${langPath}/assistant.json`

    cloudLoading.value = true
    cloudError.value = null

    try {
      const result = await window.api.app.fetchRemoteConfig(url)
      if (!result.success || !result.data) {
        cloudError.value = result.error || 'Failed to fetch cloud catalog'
        cloudCatalog.value = []
        return
      }

      const data = result.data as CloudAssistantItem[]
      if (!Array.isArray(data)) {
        cloudError.value = 'Invalid catalog format'
        cloudCatalog.value = []
        return
      }

      cloudCatalog.value = data.filter((item) => item.id && item.name && item.path)
    } catch (error) {
      cloudError.value = String(error)
      cloudCatalog.value = []
    } finally {
      cloudLoading.value = false
    }
  }

  async function importFromCloud(item: CloudAssistantItem): Promise<{ success: boolean; error?: string }> {
    const mdUrl = `${CLOUD_MARKET_BASE_URL}${item.path}`

    try {
      const mdResult = await window.api.app.fetchRemoteConfig(mdUrl)
      if (!mdResult.success || typeof mdResult.data !== 'string') {
        return { success: false, error: mdResult.error || 'Failed to fetch assistant content' }
      }

      const result = await window.assistantApi.importFromMd(mdResult.data)
      if (result.success) {
        await loadAssistants()
      }
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  function isCloudItemImported(id: string): boolean {
    return assistants.value.some((a) => a.id === id)
  }

  // ==================== 基础 CRUD ====================

  function selectAssistant(id: string): void {
    selectedAssistantId.value = id
  }

  function clearSelection(): void {
    selectedAssistantId.value = null
  }

  async function getAssistantConfig(id: string): Promise<AssistantConfigFull | null> {
    try {
      return await window.assistantApi.getConfig(id)
    } catch (error) {
      console.error('[AssistantStore] Failed to get config:', error)
      return null
    }
  }

  async function updateAssistant(
    id: string,
    updates: Partial<AssistantConfigFull>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await window.assistantApi.update(id, updates)
      if (result.success) {
        await loadAssistants()
      }
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async function resetAssistant(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await window.assistantApi.reset(id)
      if (result.success) {
        await loadAssistants()
      }
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async function importAssistant(builtinId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await window.assistantApi.importAssistant(builtinId)
      if (result.success) {
        await loadAssistants()
        await loadBuiltinCatalog()
      }
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async function reimportAssistant(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await window.assistantApi.reimportAssistant(id)
      if (result.success) {
        await loadAssistants()
        await loadBuiltinCatalog()
      }
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async function createAssistant(
    config: Omit<AssistantConfigFull, 'id'>
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const result = await window.assistantApi.create(config)
      if (result.success) {
        await loadAssistants()
      }
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async function duplicateAssistant(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const config = await window.assistantApi.getConfig(id)
      if (!config) {
        return { success: false, error: 'Assistant not found' }
      }
      const { id: _id, builtinId: _bid, ...rest } = config
      const result = await window.assistantApi.create({
        ...rest,
        name: `${config.name}${i18n.global.t('ai.assistant.duplicateSuffix')}`,
      })
      if (result.success) {
        await loadAssistants()
      }
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async function deleteAssistant(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await window.assistantApi.delete(id)
      if (result.success) {
        await loadAssistants()
      }
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  return {
    assistants,
    selectedAssistantId,
    selectedAssistant,
    isLoaded,
    builtinCatalog,
    builtinTsToolNames,
    cloudCatalog,
    cloudLoading,
    cloudError,
    cloudCatalogWithStatus,
    currentChatType,
    currentLocale,
    filteredAssistants,
    defaultAssistants,
    moreAssistants,
    hasMoreAssistants,
    loadAssistants,
    loadBuiltinCatalog,
    loadBuiltinTsToolNames,
    fetchCloudCatalog,
    importFromCloud,
    isCloudItemImported,
    selectAssistant,
    clearSelection,
    setFilterContext,
    getAssistantConfig,
    updateAssistant,
    createAssistant,
    duplicateAssistant,
    resetAssistant,
    importAssistant,
    reimportAssistant,
    deleteAssistant,
  }
})
