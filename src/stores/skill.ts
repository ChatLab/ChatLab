/**
 * 技能管理 Store
 * 管理技能列表缓存、当前激活技能、配置 CRUD、内置技能目录
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useAssistantStore } from './assistant'

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

export const useSkillStore = defineStore('skill', () => {
  const skills = ref<SkillSummary[]>([])
  const activeSkillId = ref<string | null>(null)
  const builtinCatalog = ref<BuiltinSkillInfo[]>([])
  const isLoaded = ref(false)

  const currentChatType = ref<'group' | 'private'>('group')

  const activeSkill = computed(() => {
    if (!activeSkillId.value) return null
    return skills.value.find((s) => s.id === activeSkillId.value) ?? null
  })

  /** 按 chatScope 过滤：'all' 或匹配当前 chatType */
  const scopedSkills = computed(() => {
    return skills.value.filter((s) => s.chatScope === 'all' || s.chatScope === currentChatType.value)
  })

  /** 在 scopedSkills 基础上按助手工具权限过滤 */
  const compatibleSkills = computed(() => {
    const assistantStore = useAssistantStore()
    const config = assistantStore.selectedAssistant
    if (!config) return scopedSkills.value

    return scopedSkills.value.filter((s) => {
      if (!s.tools.length) return true
      // 需要对当前助手的 allowedBuiltinTools 做兼容检查
      // 但 AssistantSummary 不含 allowedBuiltinTools，所以这里不做严格过滤
      // 严格兼容检查在后端 getSkillMenu 中完成
      return true
    })
  })

  /** 按 tags 分组 */
  const groupedSkills = computed(() => {
    const groups: Record<string, SkillSummary[]> = {}
    for (const skill of compatibleSkills.value) {
      const tag = skill.tags[0] || 'other'
      if (!groups[tag]) groups[tag] = []
      groups[tag].push(skill)
    }
    return groups
  })

  function setFilterContext(chatType: 'group' | 'private'): void {
    currentChatType.value = chatType
  }

  async function loadSkills(): Promise<void> {
    try {
      skills.value = await window.skillApi.getAll()
      isLoaded.value = true
    } catch (error) {
      console.error('[SkillStore] Failed to load skills:', error)
    }
  }

  async function loadBuiltinCatalog(): Promise<void> {
    try {
      builtinCatalog.value = await window.skillApi.getBuiltinCatalog()
    } catch (error) {
      console.error('[SkillStore] Failed to load builtin catalog:', error)
    }
  }

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
        await loadBuiltinCatalog()
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
    activeSkill,
    scopedSkills,
    compatibleSkills,
    groupedSkills,
    setFilterContext,
    loadSkills,
    loadBuiltinCatalog,
    activateSkill,
    getSkillConfig,
    updateSkill,
    createSkill,
    deleteSkill,
    importSkill,
    reimportSkill,
  }
})
