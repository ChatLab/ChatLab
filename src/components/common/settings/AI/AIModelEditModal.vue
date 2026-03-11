<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import AlertTips from './AlertTips.vue'
import ApiKeyInput from './ApiKeyInput.vue'
import Tabs from '@/components/UI/Tabs.vue'

const { t, locale } = useI18n()
const settingsStore = useSettingsStore()

// 仅在中文环境显示的提供商（中国市场特定）
const CHINA_MARKET_PROVIDERS = ['kimi', 'doubao']

// Get localized provider name
function getLocalizedProviderName(providerId: string): string {
  const key = `providers.${providerId}.name`
  const translated = t(key)
  return translated === key ? providerId : translated
}

// Get localized provider description
function getLocalizedProviderDescription(providerId: string): string {
  const key = `providers.${providerId}.description`
  const translated = t(key)
  return translated === key ? '' : translated
}

// Get localized model description
function getLocalizedModelDescription(providerId: string, modelId: string): string {
  const key = `providers.${providerId}.models.${modelId}`
  const translated = t(key)
  return translated === key ? '' : translated
}

// ============ 类型定义 ============

interface AIServiceConfig {
  id: string
  name: string
  provider: string
  apiKey: string
  apiKeySet: boolean
  model?: string
  baseUrl?: string
  disableThinking?: boolean
  isReasoningModel?: boolean
  createdAt: number
  updatedAt: number
}

interface Provider {
  id: string
  name: string
  description: string
  defaultBaseUrl: string
  models: Array<{ id: string; name: string; description?: string }>
}

// 三种配置类型
type ConfigType = 'preset' | 'local' | 'openai-compatible'

const aiTips = computed(() => {
  const config = JSON.parse(
    localStorage.getItem(`chatlab_app_config_${locale.value}`) || localStorage.getItem('chatlab_app_config') || '{}'
  )
  return config.aiTips || {}
})

// ============ Props & Emits ============

const props = defineProps<{
  open: boolean
  mode: 'add' | 'edit'
  config: AIServiceConfig | null
  providers: Provider[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

// ============ 状态 ============

const configType = ref<ConfigType>('preset')
const isValidating = ref(false)
const isSaving = ref(false)
const showAdvanced = ref(false)

const formData = ref({
  name: '',
  provider: '',
  apiKey: '',
  model: '',
  baseUrl: '',
  disableThinking: true, // 默认禁用思考模式
  isReasoningModel: false, // 是否为推理模型
})

const validationResult = ref<'idle' | 'valid' | 'invalid'>('idle')
const validationMessage = ref('')

// ============ 计算属性 ============

// 预设服务商（排除 openai-compatible，英文环境下排除中国市场特定提供商）
const presetProviders = computed(() => {
  return props.providers.filter((p) => {
    // 排除 openai-compatible（通过另一个配置类型访问）
    if (p.id === 'openai-compatible') return false
    // 非中文环境下，排除中国市场特定提供商
    if (!settingsStore.locale.startsWith('zh') && CHINA_MARKET_PROVIDERS.includes(p.id)) {
      return false
    }
    return true
  })
})

const currentProvider = computed(() => {
  return props.providers.find((p) => p.id === formData.value.provider)
})

const modelOptions = computed(() => {
  if (!currentProvider.value) return []
  return currentProvider.value.models.map((m) => ({
    label: m.name,
    value: m.id,
    description: getLocalizedModelDescription(currentProvider.value!.id, m.id) || m.description,
  }))
})

const selectedModel = computed(() => {
  if (!currentProvider.value) return null
  return currentProvider.value.models.find((m) => m.id === formData.value.model)
})

const canSave = computed(() => {
  const { provider, apiKey, baseUrl, model } = formData.value

  if (props.mode === 'add') {
    switch (configType.value) {
      case 'preset':
        // 预设服务：需要提供商、API Key（名称选填）
        return provider && apiKey.trim()
      case 'local':
        // 本地服务：需要端点、模型名（名称选填）
        return baseUrl.trim() && model.trim()
      case 'openai-compatible':
        // OpenAI 兼容：需要端点、API Key、模型名（名称选填）
        return baseUrl.trim() && apiKey.trim() && model.trim()
    }
  }

  // 编辑模式
  if (formData.value.provider === 'openai-compatible') {
    if (configType.value === 'local') {
      return baseUrl.trim() && model.trim()
    }
    return baseUrl.trim() && model.trim()
  }
  return provider
})

const modalTitle = computed(() =>
  props.mode === 'add' ? t('settings.aiConfig.modal.addConfig') : t('settings.aiConfig.modal.editConfig')
)

// ============ 方法 ============

function resetForm() {
  configType.value = 'preset'
  showAdvanced.value = false
  formData.value = {
    name: '',
    provider: presetProviders.value[0]?.id || '',
    apiKey: '',
    model: presetProviders.value[0]?.models[0]?.id || '',
    baseUrl: '',
    disableThinking: true, // 默认禁用思考模式
    isReasoningModel: false, // 是否为推理模型
  }
  validationResult.value = 'idle'
  validationMessage.value = ''
}

function initFromConfig(config: AIServiceConfig) {
  // 判断配置类型
  if (config.provider === 'openai-compatible') {
    // 根据是否有 API Key 和 baseUrl 判断是本地还是 OpenAI 兼容
    const isLocal = !config.apiKeySet || (config.baseUrl?.includes('localhost') ?? false)
    configType.value = isLocal ? 'local' : 'openai-compatible'
    showAdvanced.value = isLocal && !!config.apiKeySet
  } else {
    configType.value = 'preset'
    showAdvanced.value = false
  }

  formData.value = {
    name: config.name,
    provider: config.provider,
    apiKey: config.apiKey || '', // 编辑时填充已有的 API Key
    model: config.model || '',
    baseUrl: config.baseUrl || '',
    disableThinking: config.disableThinking ?? true, // 默认禁用
    isReasoningModel: config.isReasoningModel ?? false, // 是否为推理模型
  }
  validationResult.value = 'idle'
  validationMessage.value = ''
}

function switchConfigType(type: ConfigType) {
  configType.value = type
  validationResult.value = 'idle'
  validationMessage.value = ''
  showAdvanced.value = false

  switch (type) {
    case 'preset':
      formData.value.provider = presetProviders.value[0]?.id || ''
      formData.value.model = presetProviders.value[0]?.models[0]?.id || ''
      formData.value.baseUrl = ''
      formData.value.apiKey = ''
      break
    case 'local':
      formData.value.provider = 'openai-compatible'
      formData.value.model = ''
      formData.value.baseUrl = 'http://localhost:11434/v1'
      formData.value.apiKey = ''
      break
    case 'openai-compatible':
      formData.value.provider = 'openai-compatible'
      formData.value.model = ''
      formData.value.baseUrl = ''
      formData.value.apiKey = ''
      break
  }
}

async function validateKey() {
  const { provider, apiKey, baseUrl } = formData.value

  // 本地服务可以不需要 API Key
  if (configType.value === 'local') {
    if (!baseUrl) return
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
      // 显示详细的错误信息
      validationMessage.value = result.error || t('settings.aiConfig.modal.validationFailed')
    }
  } catch (error) {
    validationResult.value = 'invalid'
    validationMessage.value = t('settings.aiConfig.modal.validationError') + String(error)
  } finally {
    isValidating.value = false
  }
}

/**
 * 生成默认配置名称
 */
function getDefaultName(): string {
  switch (configType.value) {
    case 'preset': {
      // 使用服务商名称
      const provider = props.providers.find((p) => p.id === formData.value.provider)
      return provider?.name || formData.value.provider
    }
    case 'local':
    case 'openai-compatible': {
      // 使用 API 端点（简化显示）
      try {
        const url = new URL(formData.value.baseUrl)
        return url.hostname
      } catch {
        return formData.value.baseUrl || t('settings.aiConfig.modal.customService')
      }
    }
    default:
      return t('settings.aiConfig.modal.unnamedConfig')
  }
}

async function saveConfig() {
  if (!canSave.value) return

  isSaving.value = true
  try {
    // 确定最终的 provider
    const finalProvider = configType.value === 'preset' ? formData.value.provider : 'openai-compatible'

    // 确定 API Key
    let finalApiKey = formData.value.apiKey.trim()
    if (!finalApiKey && configType.value === 'local') {
      finalApiKey = 'sk-no-key-required'
    }

    // 确定名称（如果未填写则自动生成）
    const finalName = formData.value.name.trim() || getDefaultName()

    if (props.mode === 'add') {
      const result = await window.llmApi.addConfig({
        name: finalName,
        provider: finalProvider,
        apiKey: finalApiKey,
        model: formData.value.model.trim() || undefined,
        baseUrl: formData.value.baseUrl.trim() || undefined,
        // 仅本地服务才传递这些选项
        disableThinking: configType.value === 'local' ? formData.value.disableThinking : undefined,
        isReasoningModel: configType.value === 'local' ? formData.value.isReasoningModel : undefined,
      })

      if (result.success) {
        emit('update:open', false)
        emit('saved')
      } else {
        console.error('添加配置失败：', result.error)
      }
    } else {
      const updates: Record<string, unknown> = {
        name: finalName,
        provider: finalProvider,
        model: formData.value.model.trim() || undefined,
        baseUrl: formData.value.baseUrl.trim() || undefined,
        // 仅本地服务才传递这些选项
        disableThinking: configType.value === 'local' ? formData.value.disableThinking : undefined,
        isReasoningModel: configType.value === 'local' ? formData.value.isReasoningModel : undefined,
      }

      if (formData.value.apiKey.trim()) {
        updates.apiKey = formData.value.apiKey.trim()
      }

      const result = await window.llmApi.updateConfig(props.config!.id, updates)

      if (result.success) {
        emit('update:open', false)
        emit('saved')
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

function closeModal() {
  emit('update:open', false)
}

// ============ 监听器 ============

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      if (props.mode === 'edit' && props.config) {
        initFromConfig(props.config)
      } else {
        resetForm()
      }
    }
  }
)

watch(
  () => formData.value.provider,
  (newProvider) => {
    const provider = props.providers.find((p) => p.id === newProvider)
    if (provider && provider.models.length > 0 && configType.value === 'preset') {
      formData.value.model = provider.models[0].id
    }
    validationResult.value = 'idle'
    validationMessage.value = ''
  }
)

watch(
  () => formData.value.apiKey,
  () => {
    validationResult.value = 'idle'
    validationMessage.value = ''
  }
)
</script>

<template>
  <UModal :open="open" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="p-6">
        <h3 class="mb-4 text-lg font-semibold text-gray-900 dark:text-white">{{ modalTitle }}</h3>

        <!-- 配置类型选择（仅新增时显示）-->
        <div v-if="mode === 'add'" class="mb-6">
          <div class="grid grid-cols-3 gap-2">
            <!-- 预设服务商 -->
            <button
              class="flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-colors"
              :class="[
                configType === 'preset'
                  ? 'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600',
              ]"
              @click="switchConfigType('preset')"
            >
              <UIcon
                name="i-heroicons-cloud"
                class="h-5 w-5"
                :class="[configType === 'preset' ? 'text-primary-500' : 'text-gray-400']"
              />
              <div class="text-center">
                <p
                  class="text-xs font-medium"
                  :class="[
                    configType === 'preset'
                      ? 'text-primary-600 dark:text-primary-400'
                      : 'text-gray-700 dark:text-gray-300',
                  ]"
                >
                  {{ t('settings.aiConfig.modal.officialApi') }}
                </p>
                <p class="mt-0.5 text-[10px] text-gray-500">{{ t('settings.aiConfig.modal.officialApiDesc') }}</p>
              </div>
            </button>

            <!-- 本地服务 -->
            <button
              class="flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-colors"
              :class="[
                configType === 'local'
                  ? 'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600',
              ]"
              @click="switchConfigType('local')"
            >
              <UIcon
                name="i-heroicons-server"
                class="h-5 w-5"
                :class="[configType === 'local' ? 'text-primary-500' : 'text-gray-400']"
              />
              <div class="text-center">
                <p
                  class="text-xs font-medium"
                  :class="[
                    configType === 'local'
                      ? 'text-primary-600 dark:text-primary-400'
                      : 'text-gray-700 dark:text-gray-300',
                  ]"
                >
                  {{ t('settings.aiConfig.modal.localService') }}
                </p>
                <p class="mt-0.5 text-[10px] text-gray-500">{{ t('settings.aiConfig.modal.localServiceDesc') }}</p>
              </div>
            </button>

            <!-- OpenAI 兼容 -->
            <button
              class="flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-colors"
              :class="[
                configType === 'openai-compatible'
                  ? 'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600',
              ]"
              @click="switchConfigType('openai-compatible')"
            >
              <UIcon
                name="i-heroicons-globe-alt"
                class="h-5 w-5"
                :class="[configType === 'openai-compatible' ? 'text-primary-500' : 'text-gray-400']"
              />
              <div class="text-center">
                <p
                  class="text-xs font-medium"
                  :class="[
                    configType === 'openai-compatible'
                      ? 'text-primary-600 dark:text-primary-400'
                      : 'text-gray-700 dark:text-gray-300',
                  ]"
                >
                  {{ t('settings.aiConfig.modal.openaiCompatible') }}
                </p>
                <p class="mt-0.5 text-[10px] text-gray-500">{{ t('settings.aiConfig.modal.openaiCompatibleDesc') }}</p>
              </div>
            </button>
          </div>
        </div>

        <div class="space-y-4">
          <!-- 配置名称（选填） -->
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.aiConfig.modal.configName') }}
              <span class="font-normal text-gray-400">{{ t('settings.aiConfig.modal.optional') }}</span>
            </label>
            <UInput
              v-model="formData.name"
              :placeholder="
                configType === 'preset'
                  ? t('settings.aiConfig.modal.configNamePlaceholderPreset')
                  : t('settings.aiConfig.modal.configNamePlaceholderCustom')
              "
              class="w-full"
            />
          </div>

          <!-- ========== 预设服务商配置 ========== -->
          <template v-if="configType === 'preset'">
            <!-- 模型指南提示 -->
            <AlertTips
              v-if="aiTips.modelGuide?.show"
              icon="i-heroicons-information-circle"
              :content="aiTips.modelGuide?.content"
              class="mb-4"
            />

            <!-- 服务商选择 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.aiConfig.modal.aiProvider') }}
              </label>
              <Tabs
                v-model="formData.provider"
                :items="presetProviders.map((p) => ({ label: getLocalizedProviderName(p.id), value: p.id }))"
                class="w-full"
              />
              <p v-if="currentProvider" class="mt-2 text-xs text-gray-500">
                {{ getLocalizedProviderDescription(currentProvider.id) || currentProvider.description }}
              </p>
            </div>

            <!-- API Key -->
            <ApiKeyInput
              v-model="formData.apiKey"
              :placeholder="t('settings.aiConfig.modal.apiKeyPlaceholder')"
              :validate-loading="isValidating"
              :validate-disabled="!formData.apiKey"
              :validate-text="t('settings.aiConfig.modal.validate')"
              :validation-result="validationResult"
              :validation-message="validationMessage"
              @validate="validateKey"
            />

            <!-- 模型选择 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.aiConfig.modal.model') }}
              </label>
              <Tabs v-model="formData.model" :items="modelOptions" />
              <!-- 模型详情 -->
              <div v-if="selectedModel && currentProvider" class="mt-3 rounded-md p-3 text-xs text-gray-500">
                <p class="mb-1 text-gray-700 dark:text-gray-300">
                  {{ selectedModel.id }}：{{
                    getLocalizedModelDescription(currentProvider.id, selectedModel.id) || selectedModel.description
                  }}
                </p>
              </div>
            </div>
          </template>

          <!-- ========== 本地服务配置 ========== -->
          <template v-else-if="configType === 'local'">
            <!-- API 端点 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.aiConfig.modal.apiEndpoint') }}
              </label>
              <div class="flex gap-2">
                <UInput v-model="formData.baseUrl" placeholder="http://localhost:11434/v1" class="flex-1" />
                <UButton :loading="isValidating" :disabled="!formData.baseUrl" variant="soft" @click="validateKey">
                  {{ t('settings.aiConfig.modal.validate') }}
                </UButton>
              </div>
            </div>

            <!-- 模型名称 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.aiConfig.modal.modelName') }}
              </label>
              <UInput
                v-model="formData.model"
                :placeholder="t('settings.aiConfig.modal.modelNamePlaceholderLocal')"
                class="w-full"
              />
              <p class="mt-1 text-xs text-gray-500">{{ t('settings.aiConfig.modal.modelNameHintLocal') }}</p>
            </div>

            <!-- 禁用思考模式 -->
            <div class="flex items-center justify-between rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
              <div>
                <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('settings.aiConfig.modal.disableThinking') }}
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ t('settings.aiConfig.modal.disableThinkingDesc') }}
                </p>
              </div>
              <USwitch v-model="formData.disableThinking" />
            </div>

            <!-- 推理模型 -->
            <div class="flex items-center justify-between rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
              <div>
                <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('settings.aiConfig.modal.isReasoningModel') }}
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ t('settings.aiConfig.modal.isReasoningModelDesc') }}
                </p>
              </div>
              <USwitch v-model="formData.isReasoningModel" />
            </div>

            <!-- 验证结果 -->
            <div v-if="validationMessage">
              <div
                v-if="validationResult === 'valid'"
                class="flex items-center gap-1 text-sm text-green-600 dark:text-green-400"
              >
                <UIcon name="i-heroicons-check-circle" class="h-4 w-4" />
                {{ validationMessage }}
              </div>
              <div
                v-else-if="validationResult === 'invalid'"
                class="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400"
              >
                <UIcon name="i-heroicons-exclamation-triangle" class="h-4 w-4" />
                {{ validationMessage }}
              </div>
            </div>

            <!-- 高级选项（API Key） -->
            <div>
              <button
                class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                @click="showAdvanced = !showAdvanced"
              >
                <UIcon
                  name="i-heroicons-chevron-right"
                  class="h-4 w-4 transition-transform"
                  :class="{ 'rotate-90': showAdvanced }"
                />
                {{ t('settings.aiConfig.modal.advancedOptions') }}
              </button>

              <div v-if="showAdvanced" class="mt-3 rounded-lg bg-gray-50 p-4 dark:bg-gray-800">
                <ApiKeyInput
                  v-model="formData.apiKey"
                  :placeholder="t('settings.aiConfig.modal.apiKeyPlaceholderLocal')"
                  :optional-text="t('settings.aiConfig.modal.optional')"
                  :hint="t('settings.aiConfig.modal.apiKeyHintLocal')"
                />
              </div>
            </div>
          </template>

          <!-- ========== OpenAI 兼容配置 ========== -->
          <template v-else>
            <!-- 风险提示 -->
            <AlertTips
              v-if="aiTips.thirdPartyApi?.show"
              icon="i-heroicons-exclamation-triangle"
              :content="aiTips.thirdPartyApi?.content"
            />

            <!-- API 端点 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.aiConfig.modal.apiEndpoint') }}
              </label>
              <UInput v-model="formData.baseUrl" class="w-full" placeholder="https://api.example.com/v1" />
              <p class="mt-1 text-xs text-gray-500">{{ t('settings.aiConfig.modal.apiEndpointHint') }}</p>
            </div>

            <!-- API Key -->
            <ApiKeyInput
              v-model="formData.apiKey"
              :placeholder="t('settings.aiConfig.modal.apiKeyPlaceholder')"
              :validate-loading="isValidating"
              :validate-disabled="!formData.apiKey || !formData.baseUrl"
              :validate-text="t('settings.aiConfig.modal.validate')"
              :validation-result="validationResult"
              :validation-message="validationMessage"
              @validate="validateKey"
            />

            <!-- 模型名称 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.aiConfig.modal.modelName') }}
              </label>
              <UInput
                v-model="formData.model"
                class="w-full"
                :placeholder="t('settings.aiConfig.modal.modelNamePlaceholder')"
              />
              <p class="mt-1 text-xs text-gray-500">{{ t('settings.aiConfig.modal.modelNameHint') }}</p>
            </div>
          </template>
        </div>

        <!-- 底部按钮 -->
        <div class="mt-6 flex justify-end gap-2">
          <UButton variant="soft" @click="closeModal">{{ t('common.cancel') }}</UButton>
          <UButton color="primary" :disabled="!canSave" :loading="isSaving" @click="saveConfig">
            {{ mode === 'add' ? t('common.add') : t('common.save') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
