import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { KeywordTemplate } from '@/types/analysis'
import type { ThinkingLevel } from '@openchatlab/core'
import type { ChartAutoMode } from '@openchatlab/shared-types'

interface ContextCompressionSettings {
  enabled: boolean
  tokenThresholdPercent: number
  bufferSizePercent: number
  maxToolResultPercent: number
}

interface AIGlobalSettings {
  maxMessagesPerRequest: number
  exportFormat: 'markdown' | 'txt'
  sqlExportFormat: 'csv' | 'json'
  enableAutoSkill: boolean
  chartAutoMode: ChartAutoMode
  searchContextBefore: number
  searchContextAfter: number
  contextCompression: ContextCompressionSettings
}

type AIGlobalSettingsUpdate = Partial<Omit<AIGlobalSettings, 'contextCompression'>> & {
  contextCompression?: Partial<ContextCompressionSettings>
}

/**
 * AI 配置与关键词模板相关的全局状态
 */
export const usePromptStore = defineStore(
  'prompt',
  () => {
    const aiConfigVersion = ref(0)
    const aiGlobalSettings = ref<AIGlobalSettings>({
      maxMessagesPerRequest: 1000,
      exportFormat: 'markdown',
      sqlExportFormat: 'csv',
      enableAutoSkill: true,
      chartAutoMode: 'suggest',
      searchContextBefore: 2,
      searchContextAfter: 2,
      contextCompression: {
        enabled: true,
        tokenThresholdPercent: 75,
        bufferSizePercent: 20,
        maxToolResultPercent: 50,
      },
    })
    const customKeywordTemplates = ref<KeywordTemplate[]>([])
    const deletedPresetTemplateIds = ref<string[]>([])

    /**
     * Per-model thinking level memory.
     * Key: `${configId}:${modelId}` — matches the current defaultAssistant slot.
     * Persisted so users' choices survive page reload.
     */
    const thinkingLevels = ref<Record<string, ThinkingLevel>>({})

    /**
     * 通知外部 AI 配置已经被修改
     */
    function notifyAIConfigChanged() {
      aiConfigVersion.value++
    }

    /**
     * 更新 AI 全局设置
     */
    function updateAIGlobalSettings(settings: AIGlobalSettingsUpdate) {
      const { contextCompression, ...baseSettings } = settings
      aiGlobalSettings.value = {
        ...aiGlobalSettings.value,
        ...baseSettings,
        contextCompression: contextCompression
          ? { ...aiGlobalSettings.value.contextCompression, ...contextCompression }
          : aiGlobalSettings.value.contextCompression,
      }
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
     * Get the remembered thinking level for a model slot.
     * Returns undefined if the user has never set a preference (core will default to 'medium').
     */
    function getThinkingLevel(configId: string, modelId: string): ThinkingLevel | undefined {
      return thinkingLevels.value[`${configId}:${modelId}`]
    }

    /**
     * Persist the user's thinking level choice for a specific model slot.
     */
    function setThinkingLevel(configId: string, modelId: string, level: ThinkingLevel) {
      thinkingLevels.value = { ...thinkingLevels.value, [`${configId}:${modelId}`]: level }
    }

    return {
      // state
      aiConfigVersion,
      aiGlobalSettings,
      customKeywordTemplates,
      deletedPresetTemplateIds,
      thinkingLevels,
      // actions
      notifyAIConfigChanged,
      updateAIGlobalSettings,
      addCustomKeywordTemplate,
      updateCustomKeywordTemplate,
      removeCustomKeywordTemplate,
      addDeletedPresetTemplateId,
      getThinkingLevel,
      setThinkingLevel,
    }
  },
  {
    persist: false,
    backendPersist: {
      pick: ['aiGlobalSettings', 'customKeywordTemplates', 'deletedPresetTemplateIds', 'thinkingLevels'],
    },
  }
)
