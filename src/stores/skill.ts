/**
 * 技能管理 Store
 * 管理技能列表缓存、当前激活技能、配置 CRUD、云端市场
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useAssistantStore } from './assistant'

const CLOUD_MARKET_BASE_URL = 'https://chatlab.fun'
const LOCALE_PATH_MAP: Record<string, string> = { 'zh-CN': 'cn', 'zh-TW': 'cn', 'en-US': 'en', 'ja-JP': 'ja' }

export interface SkillSummary {
  id: string
  name: string
  description: string
  tags: string[]
  chatScope: 'all' | 'group' | 'private'
  tools: string[]
  builtinId?: string
}

export interface SkillConfigFull {
  id: string
  name: string
  description: string
  tags: string[]
  chatScope: 'all' | 'group' | 'private'
  prompt: string
  tools: string[]
  builtinId?: string
}

export interface BuiltinSkillInfo extends SkillSummary {
  imported: boolean
  hasUpdate: boolean
}

export interface CloudSkillItem {
  id: string
  name: string
  description: string
  chatScope: 'all' | 'group' | 'private'
  tags: string[]
  path: string
}

export const useSkillStore = defineStore('skill', () => {
  const skills = ref<SkillSummary[]>([])
  const activeSkillId = ref<string | null>(null)
  const isLoaded = ref(false)

  /** @deprecated 本地内置目录已清空，保留兼容 */
  const builtinCatalog = ref<BuiltinSkillInfo[]>([])

  /** 云端市场目录 */
  const cloudCatalog = ref<CloudSkillItem[]>([])
  const cloudLoading = ref(false)
  const cloudError = ref<string | null>(null)

  const currentChatType = ref<'group' | 'private'>('group')
  const currentLocale = ref<string>('zh-CN')

  const activeSkill = computed(() => {
    if (!activeSkillId.value) return null
    return skills.value.find((s) => s.id === activeSkillId.value) ?? null
  })

  const scopedSkills = computed(() => {
    return skills.value.filter((s) => s.chatScope === 'all' || s.chatScope === currentChatType.value)
  })

  const compatibleSkills = computed(() => {
    const assistantStore = useAssistantStore()
    const config = assistantStore.selectedAssistant
    if (!config) return scopedSkills.value

    return scopedSkills.value.filter((s) => {
      if (!s.tools.length) return true
      return true
    })
  })

  const groupedSkills = computed(() => {
    const groups: Record<string, SkillSummary[]> = {}
    for (const skill of compatibleSkills.value) {
      const tag = skill.tags[0] || 'other'
      if (!groups[tag]) groups[tag] = []
      groups[tag].push(skill)
    }
    return groups
  })

  /** 云端目录中标注导入状态 */
  const cloudCatalogWithStatus = computed(() => {
    const localIds = new Set(skills.value.map((s) => s.id))
    return cloudCatalog.value.map((item) => ({
      ...item,
      imported: localIds.has(item.id),
    }))
  })

  function setFilterContext(chatType: 'group' | 'private', locale?: string): void {
    currentChatType.value = chatType
    if (locale) currentLocale.value = locale
  }

  async function loadSkills(): Promise<void> {
    try {
      skills.value = await window.skillApi.getAll()
      isLoaded.value = true
    } catch (error) {
      console.error('[SkillStore] Failed to load skills:', error)
    }
  }

  /** @deprecated 本地内置目录已清空，保留兼容 */
  async function loadBuiltinCatalog(): Promise<void> {
    try {
      builtinCatalog.value = await window.skillApi.getBuiltinCatalog()
    } catch (error) {
      console.error('[SkillStore] Failed to load builtin catalog:', error)
    }
  }

  // ==================== 云端市场 ====================

  async function fetchCloudCatalog(): Promise<void> {
    const langPath = LOCALE_PATH_MAP[currentLocale.value] ?? 'en'
    const url = `${CLOUD_MARKET_BASE_URL}/${langPath}/skill.json`

    cloudLoading.value = true
    cloudError.value = null

    try {
      const result = await window.api.app.fetchRemoteConfig(url)
      if (!result.success || !result.data) {
        cloudError.value = result.error || 'Failed to fetch cloud catalog'
        cloudCatalog.value = []
        return
      }

      const data = result.data as CloudSkillItem[]
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

  async function importFromCloud(item: CloudSkillItem): Promise<{ success: boolean; error?: string }> {
    const mdUrl = `${CLOUD_MARKET_BASE_URL}${item.path}`

    try {
      const mdResult = await window.api.app.fetchRemoteConfig(mdUrl)
      if (!mdResult.success || typeof mdResult.data !== 'string') {
        return { success: false, error: mdResult.error || 'Failed to fetch skill content' }
      }

      const result = await window.skillApi.importFromMd(mdResult.data)
      if (result.success) {
        await loadSkills()
      }
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  function isCloudItemImported(id: string): boolean {
    return skills.value.some((s) => s.id === id)
  }

  // ==================== 基础 CRUD ====================

  function activateSkill(id: string | null): void {
    activeSkillId.value = id
  }

  async function getSkillConfig(id: string): Promise<SkillConfigFull | null> {
    try {
      return await window.skillApi.getConfig(id)
    } catch (error) {
      console.error('[SkillStore] Failed to get skill config:', error)
      return null
    }
  }

  async function updateSkill(id: string, rawMd: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await window.skillApi.update(id, rawMd)
      if (result.success) {
        await loadSkills()
      }
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async function createSkill(rawMd: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const result = await window.skillApi.create(rawMd)
      if (result.success) {
        await loadSkills()
      }
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async function deleteSkill(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await window.skillApi.delete(id)
      if (result.success) {
        if (activeSkillId.value === id) {
          activeSkillId.value = null
        }
        await loadSkills()
      }
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async function importSkill(builtinId: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const result = await window.skillApi.importSkill(builtinId)
      if (result.success) {
        await loadSkills()
        await loadBuiltinCatalog()
      }
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async function reimportSkill(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await window.skillApi.reimportSkill(id)
      if (result.success) {
        await loadSkills()
        await loadBuiltinCatalog()
      }
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  return {
    skills,
    activeSkillId,
    builtinCatalog,
    isLoaded,
    currentChatType,
    currentLocale,
    activeSkill,
    scopedSkills,
    compatibleSkills,
    groupedSkills,
    cloudCatalog,
    cloudLoading,
    cloudError,
    cloudCatalogWithStatus,
    setFilterContext,
    loadSkills,
    loadBuiltinCatalog,
    fetchCloudCatalog,
    importFromCloud,
    isCloudItemImported,
    activateSkill,
    getSkillConfig,
    updateSkill,
    createSkill,
    deleteSkill,
    importSkill,
    reimportSkill,
  }
})
