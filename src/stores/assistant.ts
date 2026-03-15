/**
 * 助手管理 Store
 * 管理助手列表缓存、当前选中助手、配置 CRUD、内置助手目录
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { i18n } from '@/i18n'

export interface AssistantSummary {
  id: string
  name: string
  systemPrompt: string
  presetQuestions: string[]
  order?: number
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
  customSqlTools?: unknown[]
  version: number
  builtinId?: string
  order?: number
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
}

export interface BuiltinAssistantInfo {
  id: string
  name: string
  systemPrompt: string
  version: number
  order?: number
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
  imported: boolean
  hasUpdate: boolean
}

export interface BuiltinSqlToolInfo {
  name: string
  description: string
}

export const useAssistantStore = defineStore('assistant', () => {
  const assistants = ref<AssistantSummary[]>([])
  const selectedAssistantId = ref<string | null>(null)
  const isLoaded = ref(false)

  /** 内置助手模板目录（助手市场数据源） */
  const builtinCatalog = ref<BuiltinAssistantInfo[]>([])

  /** 内置 SQL 工具目录 */
  const builtinSqlTools = ref<BuiltinSqlToolInfo[]>([])

  /** 内置 TS 工具名称列表 */
  const builtinTsToolNames = ref<string[]>([])

  /** 当前过滤条件 */
  const currentChatType = ref<'group' | 'private'>('group')
  const currentLocale = ref<string>('zh-CN')

  const selectedAssistant = computed(() => {
    if (!selectedAssistantId.value) return null
    return assistants.value.find((a) => a.id === selectedAssistantId.value) ?? null
  })

  /** 根据聊天类型和语言过滤后的助手列表（导入的 = 全部可用的） */
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

  async function loadBuiltinCatalog(): Promise<void> {
    try {
      builtinCatalog.value = await window.assistantApi.getBuiltinCatalog()
    } catch (error) {
      console.error('[AssistantStore] Failed to load builtin catalog:', error)
    }
  }

  async function loadBuiltinSqlTools(): Promise<void> {
    try {
      builtinSqlTools.value = await window.assistantApi.getBuiltinSqlTools()
    } catch (error) {
      console.error('[AssistantStore] Failed to load builtin sql tools:', error)
    }
  }

  async function loadBuiltinTsToolNames(): Promise<void> {
    try {
      builtinTsToolNames.value = await window.assistantApi.getBuiltinTsToolNames()
    } catch (error) {
      console.error('[AssistantStore] Failed to load builtin ts tool names:', error)
    }
  }

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
    config: Omit<AssistantConfigFull, 'id' | 'version'>
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
      const { id: _id, version: _ver, builtinId: _bid, ...rest } = config
      const result = await window.assistantApi.create({
        ...rest,
        name: `${config.name}${i18n.global.t('ai.assistant.duplicateSuffix')}`,
      })
      if (result.success) {
        await loadAssistants()
        await loadBuiltinCatalog()
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
        await loadBuiltinCatalog()
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
    builtinSqlTools,
    builtinTsToolNames,
    currentChatType,
    currentLocale,
    filteredAssistants,
    defaultAssistants,
    moreAssistants,
    hasMoreAssistants,
    loadAssistants,
    loadBuiltinCatalog,
    loadBuiltinSqlTools,
    loadBuiltinTsToolNames,
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
