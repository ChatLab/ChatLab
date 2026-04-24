import { ref, computed, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { useLLMStore } from '@/stores/llm'

// ==================== 类型 ====================

export interface AIServiceConfig {
  id: string
  name: string
  provider: string
  apiKey?: string
  apiKeySet: boolean
  model?: string
  baseUrl?: string
  apiFormat?: string
  disableThinking?: boolean
  isReasoningModel?: boolean
  customModels?: Array<{ id: string; name: string }>
  createdAt: number
  updatedAt: number
}

export const API_FORMAT_DEFAULT = 'openai-completions'

export const API_FORMAT_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: 'openai-completions', labelKey: 'settings.aiConfig.modal.apiFormatOpenAI' },
  { value: 'anthropic-messages', labelKey: 'settings.aiConfig.modal.apiFormatAnthropic' },
  { value: 'google-generative-ai', labelKey: 'settings.aiConfig.modal.apiFormatGemini' },
  { value: 'openai-responses', labelKey: 'settings.aiConfig.modal.apiFormatOpenAIResponses' },
]

export interface Provider {
  id: string
  name: string
  defaultBaseUrl: string
  models: Array<{ id: string; name: string; description?: string }>
}

export type ConnectionMode = 'preset' | 'local' | 'openai-compat'

// ==================== Composable ====================

const CHINA_MARKET_PROVIDERS = ['doubao', 'siliconflow']

export function useAIConfigForm(props: {
  open: Ref<boolean>
  mode: Ref<'add' | 'edit'>
  config: Ref<AIServiceConfig | null>
  providers: Ref<Provider[]>
  onClose: () => void
  onSaved: () => void
}) {
  const { t, locale } = useI18n()
  const settingsStore = useSettingsStore()
  const llmStore = useLLMStore()

  // ============ 工具函数 ============

  function getLocalizedProviderName(providerId: string): string {
    const key = `providers.${providerId}.name`
    const translated = t(key)
    return translated === key ? providerId : translated
  }

  // ============ 响应式状态 ============

  const aiTips = computed(() => {
    const config = JSON.parse(
      localStorage.getItem(`chatlab_app_config_${locale.value}`) || localStorage.getItem('chatlab_app_config') || '{}'
    )
    return config.aiTips || {}
  })

  const connectionMode = ref<ConnectionMode>('preset')
  const connectionModeItems = computed(() => [
    { label: t('settings.aiConfig.modal.presetService'), value: 'preset' },
    { label: t('settings.aiConfig.modal.thirdPartyService'), value: 'openai-compat' },
    { label: t('settings.aiConfig.modal.localService'), value: 'local' },
  ])

  const isValidating = ref(false)
  const isSaving = ref(false)
  const showValidationFailConfirm = ref(false)
  const validationFailMessage = ref('')

  const showAddModelDialog = ref(false)
  const newModelName = ref('')
  const newModelId = ref('')
  const compatModels = ref<Array<{ id: string; name: string }>>([])

  const formData = ref({
    provider: '',
    apiKey: '',
    model: '',
    baseUrl: '',
    apiFormat: API_FORMAT_DEFAULT,
    customName: '',
    disableThinking: true,
    isReasoningModel: false,
  })

  const validationResult = ref<'idle' | 'valid' | 'invalid'>('idle')
  const validationMessage = ref('')

  // ============ 计算属性 ============

  const registryProviders = computed(() => {
    return llmStore.providerRegistry.filter((p) => {
      if (!settingsStore.locale.startsWith('zh') && CHINA_MARKET_PROVIDERS.includes(p.id)) {
        return false
      }
      return true
    })
  })

  const officialProviders = computed(() =>
    registryProviders.value.filter((p) => p.kind === 'official' && p.id !== 'openai-compatible')
  )

  const customProviders = computed(() => registryProviders.value.filter((p) => !p.builtin))

  const currentProviderDef = computed(() => llmStore.providerRegistry.find((p) => p.id === formData.value.provider))

  const isLocalMode = computed(() => connectionMode.value === 'local')
  const isOpenAICompat = computed(() => connectionMode.value === 'openai-compat')
  const isPresetMode = computed(() => connectionMode.value === 'preset')
  const isCompatMode = computed(() => isLocalMode.value || isOpenAICompat.value)

  const catalogModels = computed(() => {
    if (!formData.value.provider) return []
    return llmStore
      .getModelsByProviderId(formData.value.provider)
      .filter((m) => !m.capabilities.includes('embedding') && !m.capabilities.includes('ranking'))
  })

  const modelTabItems = computed(() => {
    if (isCompatMode.value) {
      return compatModels.value.map((m) => ({ label: m.name, value: m.id }))
    }
    return catalogModels.value.map((m) => ({
      label: m.name,
      value: m.id,
    }))
  })

  const selectedModelIsCustom = computed(() => {
    if (!formData.value.model) return false
    if (isCompatMode.value) {
      return compatModels.value.some((m) => m.id === formData.value.model)
    }
    const model = catalogModels.value.find((m) => m.id === formData.value.model)
    return model ? !model.builtin : false
  })

  const canSave = computed(() => {
    const { provider, apiKey, baseUrl, model } = formData.value

    if (isLocalMode.value) {
      return baseUrl.trim() && model.trim()
    }

    if (isOpenAICompat.value) {
      return baseUrl.trim() && apiKey.trim() && model.trim()
    }

    if (!provider) return false
    return apiKey.trim()
  })

  const apiFormatItems = computed(() =>
    API_FORMAT_OPTIONS.map((opt) => ({
      label: t(opt.labelKey),
      value: opt.value,
    }))
  )

  const modalTitle = computed(() =>
    props.mode.value === 'add' ? t('settings.aiConfig.modal.addConfig') : t('settings.aiConfig.modal.editConfig')
  )

  // ============ 表单操作 ============

  function resetForm() {
    connectionMode.value = 'preset'
    compatModels.value = []
    const defaultProvider = officialProviders.value[0]?.id || ''
    const defaultModels = defaultProvider ? llmStore.getModelsByProviderId(defaultProvider) : []
    const defaultChat = defaultModels.find((m) => m.recommendedFor.includes('chat'))
    const defaultProviderDef = defaultProvider ? llmStore.providerRegistry.find((p) => p.id === defaultProvider) : null
    formData.value = {
      provider: defaultProvider,
      apiKey: '',
      model: defaultChat?.id || defaultModels[0]?.id || '',
      baseUrl: defaultProviderDef?.defaultBaseUrl || '',
      apiFormat: API_FORMAT_DEFAULT,
      customName: '',
      disableThinking: true,
      isReasoningModel: false,
    }
    validationResult.value = 'idle'
    validationMessage.value = ''
  }

  function initFromConfig(config: AIServiceConfig) {
    const providerDef = llmStore.providerRegistry.find((p) => p.id === config.provider)
    const isCompat = config.provider === 'openai-compatible' || config.provider.startsWith('custom:')
    const hasModelInCatalog = !!(config.model && llmStore.getModelById(config.provider, config.model))

    if (isCompat) {
      const looksLocal = !config.apiKeySet || (config.baseUrl?.includes('localhost') ?? false)
      connectionMode.value = looksLocal ? 'local' : 'openai-compat'
      if (config.customModels && config.customModels.length > 0) {
        compatModels.value = [...config.customModels]
      } else {
        compatModels.value = config.model ? [{ id: config.model, name: config.model }] : []
      }
    } else {
      connectionMode.value = 'preset'
      compatModels.value = []
    }

    formData.value = {
      provider: config.provider,
      apiKey: config.apiKey || '',
      model: isCompat ? config.model || '' : hasModelInCatalog ? config.model || '' : '',
      baseUrl: config.baseUrl || providerDef?.defaultBaseUrl || '',
      apiFormat: config.apiFormat || API_FORMAT_DEFAULT,
      customName: config.name || '',
      disableThinking: config.disableThinking ?? true,
      isReasoningModel: config.isReasoningModel ?? false,
    }
    validationResult.value = 'idle'
    validationMessage.value = ''
  }

  function selectProvider(providerId: string) {
    formData.value.provider = providerId
    validationResult.value = 'idle'
    validationMessage.value = ''

    formData.value.baseUrl = llmStore.providerRegistry.find((p) => p.id === providerId)?.defaultBaseUrl || ''
    const models = llmStore.getModelsByProviderId(providerId)
    const chatModels = models.filter((m) => m.recommendedFor.includes('chat'))
    formData.value.model = chatModels[0]?.id || models[0]?.id || ''
    formData.value.apiKey = ''
  }

  function onConnectionModeChange(mode: string | number) {
    connectionMode.value = mode as ConnectionMode
    validationResult.value = 'idle'
    validationMessage.value = ''

    if (mode === 'local') {
      formData.value.provider = 'openai-compatible'
      formData.value.baseUrl = 'http://localhost:11434/v1'
      formData.value.model = compatModels.value[0]?.id || ''
      formData.value.apiKey = ''
    } else if (mode === 'openai-compat') {
      formData.value.provider = 'openai-compatible'
      formData.value.baseUrl = ''
      formData.value.model = compatModels.value[0]?.id || ''
      formData.value.apiKey = ''
    } else {
      compatModels.value = []
      const defaultProvider = officialProviders.value[0]?.id || ''
      formData.value.provider = defaultProvider
      formData.value.baseUrl = llmStore.providerRegistry.find((p) => p.id === defaultProvider)?.defaultBaseUrl || ''
      const models = defaultProvider ? llmStore.getModelsByProviderId(defaultProvider) : []
      const chatModels = models.filter((m) => m.recommendedFor.includes('chat'))
      formData.value.model = chatModels[0]?.id || models[0]?.id || ''
      formData.value.apiKey = ''
    }
  }

  // ============ 自定义模型 CRUD ============

  function openAddModelDialog() {
    newModelName.value = ''
    newModelId.value = ''
    showAddModelDialog.value = true
  }

  async function confirmAddModel() {
    const modelId = newModelId.value.trim()
    const modelName = newModelName.value.trim() || modelId
    if (!modelId) return

    if (isCompatMode.value) {
      if (!compatModels.value.some((m) => m.id === modelId)) {
        compatModels.value.push({ id: modelId, name: modelName })
      }
      formData.value.model = modelId
      showAddModelDialog.value = false
      return
    }

    const providerId = formData.value.provider || 'openai-compatible'

    try {
      await window.llmApi.addCustomModel({
        id: modelId,
        providerId,
        name: modelName,
        capabilities: ['chat'],
        recommendedFor: [],
        description: '',
        status: 'stable',
      })
      await llmStore.refreshConfigs()
      formData.value.model = modelId
      showAddModelDialog.value = false
    } catch (error) {
      console.error('添加自定义模型失败：', error)
    }
  }

  async function deleteCustomModel(modelId: string) {
    if (isCompatMode.value) {
      const index = compatModels.value.findIndex((m) => m.id === modelId)
      if (index !== -1) compatModels.value.splice(index, 1)
      if (formData.value.model === modelId) {
        formData.value.model = compatModels.value[0]?.id || ''
      }
      return
    }

    const providerId = formData.value.provider || 'openai-compatible'
    try {
      await window.llmApi.deleteCustomModel(providerId, modelId)
      await llmStore.refreshConfigs()
      if (formData.value.model === modelId) {
        const models = catalogModels.value
        formData.value.model = models[0]?.id || ''
      }
    } catch (error) {
      console.error('删除自定义模型失败：', error)
    }
  }

  // ============ 验证 ============

  async function validateKey() {
    const { provider, apiKey, baseUrl } = formData.value

    if (!isPresetMode.value) {
      if (!baseUrl) return
      if (isOpenAICompat.value && !apiKey) return
    } else {
      if (!provider || !apiKey) {
        validationResult.value = 'idle'
        validationMessage.value = ''
        return
      }
    }

    isValidating.value = true
    validationResult.value = 'idle'

    try {
      const testApiKey = apiKey || 'sk-no-key-required'
      const result = await window.llmApi.validateApiKey(
        provider || 'openai-compatible',
        testApiKey,
        baseUrl || undefined,
        formData.value.model || undefined
      )
      validationResult.value = result.success ? 'valid' : 'invalid'
      if (result.success) {
        validationMessage.value = t('settings.aiConfig.modal.validationSuccess')
      } else {
        validationMessage.value = result.error || t('settings.aiConfig.modal.validationFailed')
      }
    } catch (error) {
      validationResult.value = 'invalid'
      validationMessage.value = t('settings.aiConfig.modal.validationError') + String(error)
    } finally {
      isValidating.value = false
    }
  }

  // ============ 保存 ============

  function generateName(): string {
    let providerName: string

    if (isCompatMode.value && formData.value.baseUrl) {
      try {
        const url = new URL(formData.value.baseUrl)
        providerName = url.hostname
      } catch {
        providerName = t('settings.aiConfig.modal.customService')
      }
    } else {
      const def = currentProviderDef.value
      providerName = def
        ? getLocalizedProviderName(def.id) || def.name
        : (() => {
            const legacy = props.providers.value.find((p) => p.id === formData.value.provider)
            if (legacy) return legacy.name
            return formData.value.baseUrl || t('settings.aiConfig.modal.customService')
          })()
    }

    const modelId = formData.value.model.trim()
    if (!modelId) return providerName

    const modelDef = llmStore.getModelById(formData.value.provider, modelId)
    const modelName = modelDef?.name || modelId
    return `${providerName} - ${modelName}`
  }

  async function doSave() {
    isSaving.value = true
    try {
      const finalProvider = formData.value.provider
      let finalApiKey = formData.value.apiKey.trim()
      if (!finalApiKey && isLocalMode.value) {
        finalApiKey = 'sk-no-key-required'
      }
      const finalName = formData.value.customName.trim() || generateName()

      const isReasoning = formData.value.isReasoningModel
      const persistCustomModels =
        isCompatMode.value && compatModels.value.length > 0
          ? compatModels.value.map((m) => ({ id: m.id, name: m.name }))
          : undefined
      if (props.mode.value === 'add') {
        const savedApiFormat = isCompatMode.value ? formData.value.apiFormat || undefined : undefined
        const result = await window.llmApi.addConfig({
          name: finalName,
          provider: finalProvider,
          apiKey: finalApiKey,
          model: formData.value.model.trim() || undefined,
          baseUrl: formData.value.baseUrl.trim() || undefined,
          apiFormat: savedApiFormat,
          disableThinking: isReasoning ? formData.value.disableThinking : undefined,
          isReasoningModel: isReasoning || undefined,
          customModels: persistCustomModels,
        })

        if (result.success) {
          props.onClose()
          props.onSaved()
        } else {
          console.error('添加配置失败：', result.error)
        }
      } else {
        const savedApiFormat = isCompatMode.value ? formData.value.apiFormat || undefined : undefined
        const updates: Record<string, unknown> = {
          name: finalName,
          provider: finalProvider,
          model: formData.value.model.trim() || undefined,
          baseUrl: formData.value.baseUrl.trim() || undefined,
          apiFormat: savedApiFormat,
          disableThinking: isReasoning ? formData.value.disableThinking : undefined,
          isReasoningModel: isReasoning || undefined,
          customModels: persistCustomModels,
        }

        if (formData.value.apiKey.trim()) {
          updates.apiKey = formData.value.apiKey.trim()
        }

        const result = await window.llmApi.updateConfig(props.config.value!.id, updates)

        if (result.success) {
          props.onClose()
          props.onSaved()
        } else {
          console.error('更新配置失败：', result.error)
        }
      }
    } catch (error) {
      console.error('保存配置失败：', error)
    } finally {
      isSaving.value = false
    }
  }

  async function saveConfig() {
    if (!canSave.value) return

    if (validationResult.value === 'valid') {
      return doSave()
    }

    isValidating.value = true
    try {
      const testApiKey = formData.value.apiKey.trim() || 'sk-no-key-required'
      const result = await window.llmApi.validateApiKey(
        formData.value.provider || 'openai-compatible',
        testApiKey,
        formData.value.baseUrl.trim() || undefined,
        formData.value.model.trim() || undefined
      )

      if (result.success) {
        validationResult.value = 'valid'
        validationMessage.value = ''
        return doSave()
      }

      validationResult.value = 'invalid'
      validationFailMessage.value = result.error || t('settings.aiConfig.modal.validationFailed')
      showValidationFailConfirm.value = true
    } catch (error) {
      validationFailMessage.value = String(error)
      showValidationFailConfirm.value = true
    } finally {
      isValidating.value = false
    }
  }

  function confirmSaveAnyway() {
    showValidationFailConfirm.value = false
    doSave()
  }

  function cancelSave() {
    showValidationFailConfirm.value = false
  }

  // ============ 监听器 ============

  watch(props.open, (isOpen) => {
    if (isOpen) {
      if (props.mode.value === 'edit' && props.config.value) {
        initFromConfig(props.config.value)
      } else {
        resetForm()
      }
    }
  })

  watch(
    () => formData.value.apiKey,
    () => {
      validationResult.value = 'idle'
      validationMessage.value = ''
    }
  )

  // ============ 返回 ============

  return {
    // 工具
    getLocalizedProviderName,

    // 状态
    aiTips,
    connectionMode,
    connectionModeItems,
    isValidating,
    isSaving,
    showValidationFailConfirm,
    validationFailMessage,
    showAddModelDialog,
    newModelName,
    newModelId,
    formData,
    validationResult,
    validationMessage,

    // 计算属性
    officialProviders,
    customProviders,
    currentProviderDef,
    isLocalMode,
    isOpenAICompat,
    isPresetMode,
    isCompatMode,
    modelTabItems,
    selectedModelIsCustom,
    canSave,
    apiFormatItems,
    modalTitle,

    // 方法
    selectProvider,
    onConnectionModeChange,
    openAddModelDialog,
    confirmAddModel,
    deleteCustomModel,
    validateKey,
    saveConfig,
    confirmSaveAnyway,
    cancelSave,
  }
}
