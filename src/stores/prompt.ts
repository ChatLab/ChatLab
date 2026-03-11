import { defineStore, storeToRefs } from 'pinia'
import { ref, computed } from 'vue'
import type { PromptPreset, AIPromptSettings } from '@/types/ai'
import type { KeywordTemplate } from '@/types/analysis'
import { DEFAULT_PRESET_ID, getBuiltinPresets, getOriginalBuiltinPreset, type LocaleType } from '@/config/prompts'
import { useSettingsStore } from './settings'

// 远程预设配置 URL 基础地址
const REMOTE_PRESET_BASE_URL = 'https://chatlab.fun'

/**
 * 远程预设的原始数据结构（从 JSON 获取）
 */
export interface RemotePresetData {
  id: string
  name: string
  /** Markdown 文件绝对路径（如 /cn/system-prompt/xxx.md） */
  path: string
  /** 简短描述（索引中提供，用于列表展示） */
  description?: string
  /** 系统提示词（从 Markdown 文件解析后填充） */
  systemPrompt?: string
  /** 适用场景：common(通用)、group(仅群聊)、private(仅私聊) */
  chatType?: 'common' | 'group' | 'private'
}

/**
 * AI 配置、提示词和关键词模板相关的全局状态
 */
export const usePromptStore = defineStore(
  'prompt',
  () => {
    // 获取当前语言设置
    const settingsStore = useSettingsStore()
    const { locale } = storeToRefs(settingsStore)

    const customPromptPresets = ref<PromptPreset[]>([])
    const builtinPresetOverrides = ref<Record<string, { name?: string; systemPrompt?: string; updatedAt?: number }>>({})
    const aiPromptSettings = ref<AIPromptSettings>({
      activePresetId: DEFAULT_PRESET_ID,
    })
    const aiConfigVersion = ref(0)
    const aiGlobalSettings = ref({
      maxMessagesPerRequest: 1000,
      maxHistoryRounds: 5, // AI上下文会话轮数限制
      exportFormat: 'markdown' as 'markdown' | 'txt', // 对话导出格式
      sqlExportFormat: 'csv' as 'csv' | 'json', // SQL Lab 导出格式
    })
    const customKeywordTemplates = ref<KeywordTemplate[]>([])
    const deletedPresetTemplateIds = ref<string[]>([])
    /** 已同步的远程预设 ID 列表（避免重复添加） */
    const fetchedRemotePresetIds = ref<string[]>([])

    /** 当前语言的内置预设列表（响应式） */
    const builtinPresets = computed(() => getBuiltinPresets(locale.value as LocaleType))

    /** 获取所有提示词预设（内置 + 覆盖 + 自定义） */
    const allPromptPresets = computed(() => {
      const mergedBuiltins = builtinPresets.value.map((preset) => {
        const override = builtinPresetOverrides.value[preset.id]
        if (override) {
          return { ...preset, ...override }
        }
        return preset
      })
      return [...mergedBuiltins, ...customPromptPresets.value]
    })

    /** 当前激活的预设 */
    const activePreset = computed(() => {
      const preset = allPromptPresets.value.find((p) => p.id === aiPromptSettings.value.activePresetId)
      return preset || builtinPresets.value.find((p) => p.id === DEFAULT_PRESET_ID)!
    })

    /**
     * 获取适用于指定聊天类型的预设列表
     * @param chatType 聊天类型
     */
    function getPresetsForChatType(chatType: 'group' | 'private'): PromptPreset[] {
      return allPromptPresets.value.filter((preset) => {
        // 内置预设始终适用
        if (preset.isBuiltIn) return true
        // 未设置 applicableTo 或 common 适用于所有类型
        if (!preset.applicableTo || preset.applicableTo === 'common') return true
        // 检查是否匹配当前类型
        return preset.applicableTo === chatType
      })
    }

    /**
     * 通知外部 AI 配置已经被修改
     */
    function notifyAIConfigChanged() {
      aiConfigVersion.value++
    }

    /**
     * 更新 AI 全局设置
     */
    function updateAIGlobalSettings(
      settings: Partial<{
        maxMessagesPerRequest: number
        maxHistoryRounds: number
        exportFormat: 'markdown' | 'txt'
        sqlExportFormat: 'csv' | 'json'
      }>
    ) {
      aiGlobalSettings.value = { ...aiGlobalSettings.value, ...settings }
      notifyAIConfigChanged()
    }

    /**
     * 新增自定义关键词模板
     */
    function addCustomKeywordTemplate(template: KeywordTemplate) {
      customKeywordTemplates.value.push(template)
    }

    /**
     * 更新自定义关键词模板
     */
    function updateCustomKeywordTemplate(templateId: string, updates: Partial<Omit<KeywordTemplate, 'id'>>) {
      const index = customKeywordTemplates.value.findIndex((t) => t.id === templateId)
      if (index !== -1) {
        customKeywordTemplates.value[index] = {
          ...customKeywordTemplates.value[index],
          ...updates,
        }
      }
    }

    /**
     * 删除自定义关键词模板
     */
    function removeCustomKeywordTemplate(templateId: string) {
      const index = customKeywordTemplates.value.findIndex((t) => t.id === templateId)
      if (index !== -1) {
        customKeywordTemplates.value.splice(index, 1)
      }
    }

    /**
     * 标记预设模板为已删除
     */
    function addDeletedPresetTemplateId(id: string) {
      if (!deletedPresetTemplateIds.value.includes(id)) {
        deletedPresetTemplateIds.value.push(id)
      }
    }

    /**
     * 添加新的提示词预设
     */
    function addPromptPreset(preset: {
      name: string
      systemPrompt: string
      applicableTo?: 'common' | 'group' | 'private'
    }) {
      const newPreset: PromptPreset = {
        id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: preset.name,
        systemPrompt: preset.systemPrompt,
        isBuiltIn: false,
        applicableTo: preset.applicableTo || 'common',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      customPromptPresets.value.push(newPreset)
      return newPreset.id
    }

    /**
     * 更新提示词预设（含内置覆盖）
     */
    function updatePromptPreset(
      presetId: string,
      updates: {
        name?: string
        systemPrompt?: string
        applicableTo?: 'common' | 'group' | 'private'
      }
    ) {
      const isBuiltin = builtinPresets.value.some((p) => p.id === presetId)
      if (isBuiltin) {
        builtinPresetOverrides.value[presetId] = {
          ...builtinPresetOverrides.value[presetId],
          name: updates.name,
          systemPrompt: updates.systemPrompt,
          updatedAt: Date.now(),
        }
        return
      }

      const index = customPromptPresets.value.findIndex((p) => p.id === presetId)
      if (index !== -1) {
        customPromptPresets.value[index] = {
          ...customPromptPresets.value[index],
          ...updates,
          updatedAt: Date.now(),
        }
      }
    }

    /**
     * 重置内置预设为初始状态
     */
    function resetBuiltinPreset(presetId: string): boolean {
      const original = getOriginalBuiltinPreset(presetId, locale.value as LocaleType)
      if (!original) return false
      delete builtinPresetOverrides.value[presetId]
      return true
    }

    /**
     * 判断内置预设是否被自定义过
     */
    function isBuiltinPresetModified(presetId: string): boolean {
      return !!builtinPresetOverrides.value[presetId]
    }

    /**
     * 删除提示词预设（自定义）
     */
    function removePromptPreset(presetId: string) {
      const index = customPromptPresets.value.findIndex((p) => p.id === presetId)
      if (index !== -1) {
        customPromptPresets.value.splice(index, 1)
        // 如果删除的是当前激活的预设，切换回默认
        if (aiPromptSettings.value.activePresetId === presetId) {
          aiPromptSettings.value.activePresetId = DEFAULT_PRESET_ID
        }
        // 如果是从远程导入的预设，同时从已导入列表中移除，以便用户可以重新导入
        const remoteIndex = fetchedRemotePresetIds.value.indexOf(presetId)
        if (remoteIndex !== -1) {
          fetchedRemotePresetIds.value.splice(remoteIndex, 1)
        }
      }
    }

    /**
     * 复制指定提示词预设
     */
    function duplicatePromptPreset(presetId: string) {
      const source = allPromptPresets.value.find((p) => p.id === presetId)
      if (source) {
        const copySuffix = locale.value.startsWith('zh') ? '(副本)' : '(Copy)'
        return addPromptPreset({
          name: `${source.name} ${copySuffix}`,
          systemPrompt: source.systemPrompt,
        })
      }
      return null
    }

    /**
     * 设置当前激活的预设
     */
    function setActivePreset(presetId: string) {
      const preset = allPromptPresets.value.find((p) => p.id === presetId)
      if (preset) {
        aiPromptSettings.value.activePresetId = presetId
        notifyAIConfigChanged()
      }
    }

    /**
     * 获取当前激活的预设
     * @param _chatType 已弃用，保留参数兼容旧代码
     */
    function getActivePresetForChatType(_chatType?: 'group' | 'private'): PromptPreset {
      return activePreset.value
    }

    /**
     * 解析 Markdown 文件内容为完整的系统提示词
     * 旧格式使用 `---` 分隔角色定义和回答要求，现统一为单一字段
     */
    function parseMarkdownContent(content: string): { systemPrompt: string } {
      return { systemPrompt: content.trim() }
    }

    /**
     * 从远程获取预设索引列表（不下载 Markdown 内容，节省流量）
     * @param locale 当前语言设置 (如 'zh-CN', 'en-US')
     * @returns 远程预设索引列表，获取失败返回空数组
     */
    async function fetchRemotePresets(locale: string): Promise<RemotePresetData[]> {
      const langPathMap: Record<string, string> = { 'zh-CN': 'cn', 'zh-TW': 'tw', 'en-US': 'en', 'ja-JP': 'ja' }
      const langPath = langPathMap[locale] ?? 'en'
      const indexUrl = `${REMOTE_PRESET_BASE_URL}/${langPath}/system-prompt.json`

      try {
        const result = await window.api.app.fetchRemoteConfig(indexUrl)
        if (!result.success || !result.data) {
          return []
        }

        const presetIndex = result.data as RemotePresetData[]
        if (!Array.isArray(presetIndex)) {
          return []
        }

        // 过滤有效的索引项（必须有 id、name、path）
        return presetIndex.filter((p) => p.id && p.name && p.path)
      } catch {
        return []
      }
    }

    /**
     * 按需下载单个预设的 Markdown 内容
     * @param preset 预设索引数据
     * @returns 包含完整内容的预设数据，失败返回 null
     */
    async function fetchPresetContent(
      preset: RemotePresetData
    ): Promise<(RemotePresetData & { systemPrompt: string }) | null> {
      if (preset.systemPrompt) {
        return preset as RemotePresetData & { systemPrompt: string }
      }

      const mdUrl = `${REMOTE_PRESET_BASE_URL}${preset.path}`
      try {
        const mdResult = await window.api.app.fetchRemoteConfig(mdUrl)
        if (!mdResult.success || typeof mdResult.data !== 'string') {
          return null
        }

        const { systemPrompt } = parseMarkdownContent(mdResult.data)
        if (!systemPrompt) {
          return null
        }

        return { ...preset, systemPrompt }
      } catch {
        return null
      }
    }

    /**
     * 添加远程预设到自定义预设列表
     * @param preset 远程预设数据
     * @returns 是否添加成功
     */
    function addRemotePreset(preset: RemotePresetData): boolean {
      if (fetchedRemotePresetIds.value.includes(preset.id)) {
        return false
      }

      const now = Date.now()
      const applicableTo = preset.chatType || 'common'

      const newPreset: PromptPreset = {
        id: preset.id,
        name: preset.name,
        systemPrompt: preset.systemPrompt || '',
        isBuiltIn: false,
        applicableTo,
        createdAt: now,
        updatedAt: now,
      }

      customPromptPresets.value.push(newPreset)
      fetchedRemotePresetIds.value.push(preset.id)
      return true
    }

    /**
     * 判断远程预设是否已添加
     * @param presetId 预设 ID
     */
    function isRemotePresetAdded(presetId: string): boolean {
      return fetchedRemotePresetIds.value.includes(presetId)
    }

    // ==================== 数据迁移（兼容旧版本） ====================

    /**
     * 迁移旧版本的预设数据
     * 将群聊/私聊分离的预设合并为统一预设
     */
    function migrateOldPresets() {
      // 检查是否存在旧版本数据结构
      const oldSettings = aiPromptSettings.value as unknown as {
        activeGroupPresetId?: string
        activePrivatePresetId?: string
        activePresetId?: string
      }

      // 如果存在旧字段，进行迁移
      if (oldSettings.activeGroupPresetId && !oldSettings.activePresetId) {
        const oldGroupId = oldSettings.activeGroupPresetId
        if (oldGroupId === 'builtin-group-default' || oldGroupId === 'builtin-private-default') {
          aiPromptSettings.value.activePresetId = DEFAULT_PRESET_ID
        } else {
          aiPromptSettings.value.activePresetId = oldGroupId
        }
        delete (aiPromptSettings.value as Record<string, unknown>).activeGroupPresetId
        delete (aiPromptSettings.value as Record<string, unknown>).activePrivatePresetId
      }

      for (const preset of customPromptPresets.value) {
        const oldPreset = preset as PromptPreset & { chatType?: string }
        if (oldPreset.chatType) {
          delete oldPreset.chatType
        }
      }

      // 迁移旧 roleDefinition + responseRules → systemPrompt
      for (const preset of customPromptPresets.value) {
        const legacy = preset as unknown as { roleDefinition?: string; responseRules?: string; systemPrompt?: string }
        if (legacy.roleDefinition && !legacy.systemPrompt) {
          preset.systemPrompt = legacy.responseRules
            ? `${legacy.roleDefinition}\n\n## 回答要求\n${legacy.responseRules}`
            : legacy.roleDefinition
          delete (preset as Record<string, unknown>).roleDefinition
          delete (preset as Record<string, unknown>).responseRules
        }
      }

      // 迁移 builtinPresetOverrides 中的旧字段
      for (const [id, override] of Object.entries(builtinPresetOverrides.value)) {
        const legacy = override as unknown as { roleDefinition?: string; responseRules?: string; systemPrompt?: string }
        if (legacy.roleDefinition && !legacy.systemPrompt) {
          override.systemPrompt = legacy.responseRules
            ? `${legacy.roleDefinition}\n\n## 回答要求\n${legacy.responseRules}`
            : legacy.roleDefinition
          delete (override as Record<string, unknown>).roleDefinition
          delete (override as Record<string, unknown>).responseRules
          builtinPresetOverrides.value[id] = override
        }
      }
    }

    // 初始化时执行迁移
    migrateOldPresets()

    return {
      // state
      customPromptPresets,
      builtinPresetOverrides,
      aiPromptSettings,
      aiConfigVersion,
      aiGlobalSettings,
      customKeywordTemplates,
      deletedPresetTemplateIds,
      fetchedRemotePresetIds,
      // getters
      allPromptPresets,
      activePreset,
      // actions
      notifyAIConfigChanged,
      updateAIGlobalSettings,
      addCustomKeywordTemplate,
      updateCustomKeywordTemplate,
      removeCustomKeywordTemplate,
      addDeletedPresetTemplateId,
      addPromptPreset,
      updatePromptPreset,
      resetBuiltinPreset,
      isBuiltinPresetModified,
      removePromptPreset,
      duplicatePromptPreset,
      setActivePreset,
      getActivePresetForChatType,
      getPresetsForChatType,
      fetchRemotePresets,
      fetchPresetContent,
      addRemotePreset,
      isRemotePresetAdded,
    }
  },
  {
    persist: [
      {
        pick: [
          'customKeywordTemplates',
          'deletedPresetTemplateIds',
          'aiGlobalSettings',
          'customPromptPresets',
          'builtinPresetOverrides',
          'aiPromptSettings',
          'fetchedRemotePresetIds',
        ],
        storage: localStorage,
      },
    ],
  }
)
