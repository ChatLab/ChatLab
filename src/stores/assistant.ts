/**
 * 助手管理 Store
 * 管理助手列表缓存、当前选中助手、配置 CRUD、云端市场
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { i18n } from '@/i18n'
import { usePlatformService, useAssistantService, usePreferencesService } from '@/services'
import {
  getDefaultGeneralAssistantId,
  type AssistantConfig,
  type AssistantSummary,
  type AssistantUpgradeInfo,
  type AssistantUpgradeResult,
  type BuiltinAssistantInfo,
} from '@openchatlab/shared-types'

import { CHATLAB_SITE_BASE } from '@/utils/chatlabSiteLocale'
const CLOUD_MARKET_BASE_URL = CHATLAB_SITE_BASE
const LOCALE_PATH_MAP: Record<string, string> = { 'zh-CN': 'cn', 'zh-TW': 'cn', 'en-US': 'en', 'ja-JP': 'ja' }

export type { AssistantSummary, BuiltinAssistantInfo } from '@openchatlab/shared-types'
export type AssistantConfigFull = AssistantConfig

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
  const checkedUpgradeAssistantIds = new Set<string>()
  let assistantUpgradeSkippedVersions: Record<string, number> | null = null

  /** @deprecated 本地内置目录已清空，保留兼容 */
  const builtinCatalog = ref<BuiltinAssistantInfo[]>([])

  /** 内置工具目录（含分类） */
  const builtinToolCatalog = ref<Array<{ name: string; category: 'core' | 'analysis' }>>([])

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
      const svc = useAssistantService()
      assistants.value = await svc.getAll()
      isLoaded.value = true
    } catch (error) {
      console.error('[AssistantStore] Failed to load assistants:', error)
    }
  }

  /** @deprecated 本地内置目录已清空，保留兼容 */
  async function loadBuiltinCatalog(): Promise<void> {
    try {
      builtinCatalog.value = await useAssistantService().getBuiltinCatalog()
    } catch (error) {
      console.error('[AssistantStore] Failed to load builtin catalog:', error)
    }
  }

  async function loadBuiltinToolCatalog(): Promise<void> {
    try {
      builtinToolCatalog.value = await useAssistantService().getBuiltinToolCatalog()
    } catch (error) {
      console.error('[AssistantStore] Failed to load builtin tool catalog:', error)
    }
  }

  // ==================== 云端市场 ====================

  async function fetchCloudCatalog(localeOverride?: string): Promise<void> {
    // 助手市场请求只依赖 locale，不应该反向修改选择页的筛选上下文。
    const langPath = LOCALE_PATH_MAP[localeOverride || currentLocale.value] ?? 'en'
    const url = `${CLOUD_MARKET_BASE_URL}/${langPath}/assistant.json`

    cloudLoading.value = true
    cloudError.value = null

    try {
      const result = await usePlatformService().fetchRemoteConfig(url)
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
      const mdResult = await usePlatformService().fetchRemoteConfig(mdUrl)
      if (!mdResult.success || typeof mdResult.data !== 'string') {
        return { success: false, error: mdResult.error || 'Failed to fetch assistant content' }
      }

      const result = await useAssistantService().importFromMd(mdResult.data)
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
      return await useAssistantService().getConfig(id)
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
      const result = await useAssistantService().update(id, updates)
      if (result.success) await loadAssistants()
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async function resetAssistant(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await useAssistantService().reset(id)
      if (result.success) await loadAssistants()
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async function checkDefaultAssistantUpgrade(locale: string): Promise<AssistantUpgradeInfo | null> {
    const assistantId = getDefaultGeneralAssistantId(locale)
    if (checkedUpgradeAssistantIds.has(assistantId)) return null

    // 同一默认助手每次启动只提示一次；请求失败时撤销标记，允许下次进入页面重试。
    checkedUpgradeAssistantIds.add(assistantId)
    try {
      const info = await useAssistantService().getUpgradeInfo(assistantId)
      if (!info) return null

      try {
        if (!assistantUpgradeSkippedVersions) {
          const preferences = await usePreferencesService().getPreferences()
          assistantUpgradeSkippedVersions = { ...preferences.assistantUpgradeSkippedVersions }
        }
        if (info.latestVersion !== null && assistantUpgradeSkippedVersions[info.builtinId] === info.latestVersion) {
          return null
        }
      } catch (error) {
        // 偏好读取失败时仍展示升级提示，避免把真实可用的升级静默吞掉。
        console.error('[AssistantStore] Failed to load skipped assistant upgrades:', error)
      }

      return info
    } catch (error) {
      checkedUpgradeAssistantIds.delete(assistantId)
      console.error('[AssistantStore] Failed to check assistant upgrade:', error)
      return null
    }
  }

  async function skipAssistantUpgrade(info: AssistantUpgradeInfo): Promise<{ success: boolean; error?: string }> {
    if (info.latestVersion === null) {
      return { success: false, error: 'Assistant template version is unavailable' }
    }

    try {
      if (!assistantUpgradeSkippedVersions) {
        const preferences = await usePreferencesService().getPreferences()
        assistantUpgradeSkippedVersions = { ...preferences.assistantUpgradeSkippedVersions }
      }
      const nextSkippedVersions = {
        ...assistantUpgradeSkippedVersions,
        [info.builtinId]: info.latestVersion,
      }
      const result = await usePreferencesService().savePreferences({
        assistantUpgradeSkippedVersions: nextSkippedVersions,
      })
      if (result.success) assistantUpgradeSkippedVersions = nextSkippedVersions
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async function upgradeAssistantWithBackup(
    info: AssistantUpgradeInfo,
    backupName: string
  ): Promise<AssistantUpgradeResult> {
    try {
      const result = await useAssistantService().upgradeWithBackup(info.assistantId, backupName)
      if (result.success) await loadAssistants()
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async function importAssistant(builtinId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await useAssistantService().importBuiltin(builtinId)
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
      const result = await useAssistantService().reimport(id)
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
      const result = await useAssistantService().create(config)
      if (result.success) await loadAssistants()
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async function duplicateAssistant(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const svc = useAssistantService()
      const config = await svc.getConfig(id)
      if (!config) return { success: false, error: 'Assistant not found' }
      const { id: _id, builtinId: _bid, ...rest } = config
      const result = await svc.create({
        ...rest,
        name: `${config.name}${i18n.global.t('ai.assistant.duplicateSuffix')}`,
      })
      if (result.success) await loadAssistants()
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async function deleteAssistant(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await useAssistantService().delete(id)
      if (result.success) await loadAssistants()
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
    builtinToolCatalog,
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
    loadBuiltinToolCatalog,
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
    checkDefaultAssistantUpgrade,
    skipAssistantUpgrade,
    upgradeAssistantWithBackup,
    importAssistant,
    reimportAssistant,
    deleteAssistant,
  }
})
