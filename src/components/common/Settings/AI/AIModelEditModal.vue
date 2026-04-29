<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { toRefs } from 'vue'
import UITabs from '@/components/UI/Tabs.vue'
import AlertTips from './AlertTips.vue'
import ApiKeyInput from './ApiKeyInput.vue'
import RemoteModelBrowser from './RemoteModelBrowser.vue'
import { useAIConfigForm, type AIServiceConfig, type Provider } from './useAIConfigForm'

const { t } = useI18n()

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

const {
  getLocalizedProviderName,
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
  newModelContextWindow,
  formData,
  validationResult,
  validationMessage,
  officialProviders,
  customProviders,
  currentProviderDef,
  isLocalMode,
  isOpenAICompat,
  isPresetMode,
  modelTabItems,
  selectedModelIsCustom,
  selectedModelContextWindow,
  canSave,
  apiFormatItems,
  modalTitle,
  resolvedApiUrl,
  isFetchingModels,
  remoteModels,
  remoteModelsError,
  showRemoteModelBrowser,
  addedModelIds,
  canFetchModels,
  showEditModelDialog,
  editModelContextWindow,
  selectProvider,
  onConnectionModeChange,
  openAddModelDialog,
  confirmAddModel,
  openEditModelDialog,
  confirmEditModel,
  deleteCustomModel,
  validateKey,
  saveConfig,
  confirmSaveAnyway,
  cancelSave,
  fetchRemoteModels,
  addRemoteModel,
  addAllRemoteModels,
} = useAIConfigForm({
  ...toRefs(props),
  onClose: () => emit('update:open', false),
  onSaved: () => emit('saved'),
})

function closeModal() {
  emit('update:open', false)
}
</script>

<template>
  <UModal
    :open="open"
    :ui="{ content: 'max-w-2xl z-[101]', overlay: 'z-[100]' }"
    @update:open="emit('update:open', $event)"
  >
    <template #content>
      <div class="flex min-h-[min(640px,80vh)] max-h-[80vh] flex-col p-6">
        <h3 class="mb-4 text-lg font-semibold text-gray-900 dark:text-white">{{ modalTitle }}</h3>

        <div class="min-h-0 flex-1 overflow-y-auto pr-1">
          <div class="space-y-4">
            <!-- ===== 连接模式 Tab ===== -->
            <UITabs
              :model-value="connectionMode"
              :items="connectionModeItems"
              size="sm"
              @update:model-value="onConnectionModeChange"
            />

            <!-- ===== 预设服务模式 ===== -->
            <template v-if="isPresetMode">
              <!-- Provider 选择 -->
              <div>
                <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('settings.aiConfig.modal.aiProvider') }}
                </label>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="p in officialProviders"
                    :key="p.id"
                    class="rounded-lg border-2 px-3 py-1.5 text-xs font-medium transition-colors"
                    :class="[
                      formData.provider === p.id
                        ? 'border-transparent bg-primary-500 text-white hover:bg-primary-600 dark:bg-primary-500 dark:text-white dark:hover:bg-primary-400'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:border-gray-600',
                    ]"
                    @click="selectProvider(p.id)"
                  >
                    {{ getLocalizedProviderName(p.id) || p.name }}
                  </button>

                  <button
                    v-for="p in customProviders"
                    :key="p.id"
                    class="rounded-lg border-2 px-3 py-1.5 text-xs font-medium transition-colors"
                    :class="[
                      formData.provider === p.id
                        ? 'border-transparent bg-primary-500 text-white hover:bg-primary-600 dark:bg-primary-500 dark:text-white dark:hover:bg-primary-400'
                        : 'border-dashed border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-400',
                    ]"
                    @click="selectProvider(p.id)"
                  >
                    {{ p.name }}
                  </button>
                </div>

                <!-- Provider 说明卡片 -->
                <div
                  v-if="currentProviderDef && (currentProviderDef.website || currentProviderDef.consoleUrl)"
                  class="mt-3 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2 dark:border-gray-800 dark:bg-gray-800/50"
                >
                  <div class="flex gap-3">
                    <a
                      v-if="currentProviderDef.website"
                      :href="currentProviderDef.website"
                      target="_blank"
                      rel="noopener"
                      class="text-xs text-primary-500 hover:underline"
                    >
                      {{ t('settings.aiConfig.modal.visitWebsite') }}
                    </a>
                    <a
                      v-if="currentProviderDef.consoleUrl"
                      :href="currentProviderDef.consoleUrl"
                      target="_blank"
                      rel="noopener"
                      class="text-xs text-primary-500 hover:underline"
                    >
                      {{ t('settings.aiConfig.modal.getApiKey') }}
                    </a>
                  </div>
                </div>
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

              <!-- API 端点（官方 Provider 自定义 URL） -->
              <div>
                <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('settings.aiConfig.modal.apiEndpoint') }}
                </label>
                <UInput
                  v-model="formData.baseUrl"
                  class="mt-2 w-full"
                  :placeholder="currentProviderDef?.defaultBaseUrl || 'https://api.example.com/v1'"
                />
                <p class="mt-1 text-[10px] text-gray-400">
                  {{ t('settings.aiConfig.modal.apiEndpointOverrideHint') }}
                </p>
                <p
                  v-if="resolvedApiUrl"
                  class="mt-1.5 flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500"
                >
                  <UIcon name="i-heroicons-link" class="h-3 w-3 shrink-0" />
                  <span>{{ t('settings.aiConfig.modal.resolvedUrl') }}</span>
                  <code
                    class="ml-0.5 break-all rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                  >
                    {{ resolvedApiUrl }}
                  </code>
                </p>
              </div>

              <!-- 模型选择 -->
              <div>
                <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('settings.aiConfig.modal.model') }}
                </label>

                <UITabs v-if="modelTabItems.length > 0" v-model="formData.model" :items="modelTabItems" size="xs" />
                <p v-if="formData.model" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {{ t('settings.aiConfig.modal.customModelId') }}: {{ formData.model }}
                  <span v-if="selectedModelContextWindow" class="ml-2">
                    · {{ t('settings.aiConfig.modal.contextWindow') }}:
                    {{
                      selectedModelContextWindow >= 1000000
                        ? (selectedModelContextWindow / 1048576).toFixed(1) + 'M'
                        : Math.round(selectedModelContextWindow / 1024) + 'K'
                    }}
                  </span>
                </p>

                <div class="mt-2 flex items-center gap-2">
                  <button
                    v-if="canFetchModels"
                    class="flex items-center gap-1 rounded-md border border-dashed border-primary-300 px-2 py-1 text-xs text-primary-500 transition-colors hover:border-primary-400 hover:text-primary-600 dark:border-primary-700 dark:text-primary-400 dark:hover:border-primary-500"
                    @click="fetchRemoteModels"
                  >
                    <UIcon name="i-heroicons-cloud-arrow-down" class="h-3.5 w-3.5" />
                    {{ t('settings.aiConfig.modal.fetchModels') }}
                  </button>
                  <button
                    v-if="currentProviderDef?.supportsCustomModels"
                    class="flex items-center gap-1 rounded-md border border-dashed border-gray-300 px-2 py-1 text-xs text-gray-500 transition-colors hover:border-primary-400 hover:text-primary-500 dark:border-gray-600 dark:text-gray-400 dark:hover:border-primary-500 dark:hover:text-primary-400"
                    @click="openAddModelDialog"
                  >
                    <UIcon name="i-heroicons-plus" class="h-3.5 w-3.5" />
                    {{ t('settings.aiConfig.modal.addCustomModel') }}
                  </button>
                  <button
                    v-if="formData.model"
                    class="flex items-center gap-1 rounded-md border border-dashed border-gray-300 px-2 py-1 text-xs text-gray-500 transition-colors hover:border-primary-400 hover:text-primary-500 dark:border-gray-600 dark:text-gray-400 dark:hover:border-primary-500 dark:hover:text-primary-400"
                    @click="openEditModelDialog"
                  >
                    <UIcon name="i-heroicons-pencil-square" class="h-3.5 w-3.5" />
                    {{ t('settings.aiConfig.modal.editModel') }}
                  </button>
                  <button
                    v-if="selectedModelIsCustom"
                    class="flex items-center gap-1 rounded-md border border-dashed border-red-200 px-2 py-1 text-xs text-red-400 transition-colors hover:border-red-400 hover:text-red-500 dark:border-red-800 dark:hover:border-red-500"
                    @click="deleteCustomModel(formData.model)"
                  >
                    <UIcon name="i-heroicons-trash" class="h-3.5 w-3.5" />
                    {{ t('settings.aiConfig.modal.deleteCustomModel') }}
                  </button>
                </div>
              </div>
            </template>

            <!-- ===== 本地服务模式 ===== -->
            <template v-else-if="isLocalMode">
              <!-- API Key -->
              <ApiKeyInput
                v-model="formData.apiKey"
                :placeholder="t('settings.aiConfig.modal.apiKeyPlaceholderLocal')"
                :optional-text="t('settings.aiConfig.modal.optional')"
                :hint="t('settings.aiConfig.modal.apiKeyHintLocal')"
              />

              <!-- API 端点 -->
              <div>
                <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('settings.aiConfig.modal.apiEndpoint') }}
                </label>
                <div class="flex gap-2">
                  <UInput v-model="formData.baseUrl" placeholder="http://localhost:11434" class="flex-1" />
                  <UButton :loading="isValidating" :disabled="!formData.baseUrl" variant="soft" @click="validateKey">
                    {{ t('settings.aiConfig.modal.validate') }}
                  </UButton>
                </div>
                <p
                  v-if="resolvedApiUrl"
                  class="mt-1.5 flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500"
                >
                  <UIcon name="i-heroicons-link" class="h-3 w-3 shrink-0" />
                  <span>{{ t('settings.aiConfig.modal.resolvedUrl') }}</span>
                  <code
                    class="ml-0.5 break-all rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                  >
                    {{ resolvedApiUrl }}
                  </code>
                </p>
              </div>

              <!-- 模型选择 -->
              <div>
                <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('settings.aiConfig.modal.model') }}
                </label>

                <UITabs v-if="modelTabItems.length > 0" v-model="formData.model" :items="modelTabItems" size="xs" />
                <p v-else class="flex items-center gap-1 text-xs text-amber-500 dark:text-amber-400">
                  <UIcon name="i-heroicons-exclamation-triangle" class="h-3.5 w-3.5 shrink-0" />
                  {{ t('settings.aiConfig.modal.modelRequired') }}
                </p>
                <p v-if="formData.model" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {{ t('settings.aiConfig.modal.customModelId') }}: {{ formData.model }}
                  <span v-if="selectedModelContextWindow" class="ml-2">
                    · {{ t('settings.aiConfig.modal.contextWindow') }}:
                    {{
                      selectedModelContextWindow >= 1000000
                        ? (selectedModelContextWindow / 1048576).toFixed(1) + 'M'
                        : Math.round(selectedModelContextWindow / 1024) + 'K'
                    }}
                  </span>
                </p>

                <div class="mt-2 flex items-center gap-2">
                  <button
                    v-if="canFetchModels"
                    class="flex items-center gap-1 rounded-md border border-dashed border-primary-300 px-2 py-1 text-xs text-primary-500 transition-colors hover:border-primary-400 hover:text-primary-600 dark:border-primary-700 dark:text-primary-400 dark:hover:border-primary-500"
                    @click="fetchRemoteModels"
                  >
                    <UIcon name="i-heroicons-cloud-arrow-down" class="h-3.5 w-3.5" />
                    {{ t('settings.aiConfig.modal.fetchModels') }}
                  </button>
                  <button
                    v-if="currentProviderDef?.supportsCustomModels"
                    class="flex items-center gap-1 rounded-md border border-dashed border-gray-300 px-2 py-1 text-xs text-gray-500 transition-colors hover:border-primary-400 hover:text-primary-500 dark:border-gray-600 dark:text-gray-400 dark:hover:border-primary-500 dark:hover:text-primary-400"
                    @click="openAddModelDialog"
                  >
                    <UIcon name="i-heroicons-plus" class="h-3.5 w-3.5" />
                    {{ t('settings.aiConfig.modal.addCustomModel') }}
                  </button>
                  <button
                    v-if="formData.model"
                    class="flex items-center gap-1 rounded-md border border-dashed border-gray-300 px-2 py-1 text-xs text-gray-500 transition-colors hover:border-primary-400 hover:text-primary-500 dark:border-gray-600 dark:text-gray-400 dark:hover:border-primary-500 dark:hover:text-primary-400"
                    @click="openEditModelDialog"
                  >
                    <UIcon name="i-heroicons-pencil-square" class="h-3.5 w-3.5" />
                    {{ t('settings.aiConfig.modal.editModel') }}
                  </button>
                  <button
                    v-if="selectedModelIsCustom"
                    class="flex items-center gap-1 rounded-md border border-dashed border-red-200 px-2 py-1 text-xs text-red-400 transition-colors hover:border-red-400 hover:text-red-500 dark:border-red-800 dark:hover:border-red-500"
                    @click="deleteCustomModel(formData.model)"
                  >
                    <UIcon name="i-heroicons-trash" class="h-3.5 w-3.5" />
                    {{ t('settings.aiConfig.modal.deleteCustomModel') }}
                  </button>
                </div>
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
            </template>

            <!-- ===== OpenAI 兼容模式 ===== -->
            <template v-else-if="isOpenAICompat">
              <AlertTips
                v-if="aiTips.thirdPartyApi?.show"
                icon="i-heroicons-exclamation-triangle"
                :content="aiTips.thirdPartyApi?.content"
              />

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

              <!-- API 端点 -->
              <div>
                <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('settings.aiConfig.modal.apiEndpoint') }}
                </label>
                <UInput v-model="formData.baseUrl" class="w-full" placeholder="https://api.example.com" />
                <p class="mt-1 text-xs text-gray-500">{{ t('settings.aiConfig.modal.apiEndpointHint') }}</p>
                <p
                  v-if="resolvedApiUrl"
                  class="mt-1.5 flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500"
                >
                  <UIcon name="i-heroicons-link" class="h-3 w-3 shrink-0" />
                  <span>{{ t('settings.aiConfig.modal.resolvedUrl') }}</span>
                  <code
                    class="ml-0.5 break-all rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                  >
                    {{ resolvedApiUrl }}
                  </code>
                </p>
              </div>

              <!-- 模型选择 -->
              <div>
                <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('settings.aiConfig.modal.model') }}
                </label>

                <UITabs v-if="modelTabItems.length > 0" v-model="formData.model" :items="modelTabItems" size="xs" />
                <p v-else class="flex items-center gap-1 text-xs text-amber-500 dark:text-amber-400">
                  <UIcon name="i-heroicons-exclamation-triangle" class="h-3.5 w-3.5 shrink-0" />
                  {{ t('settings.aiConfig.modal.modelRequired') }}
                </p>
                <p v-if="formData.model" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {{ t('settings.aiConfig.modal.customModelId') }}: {{ formData.model }}
                  <span v-if="selectedModelContextWindow" class="ml-2">
                    · {{ t('settings.aiConfig.modal.contextWindow') }}:
                    {{
                      selectedModelContextWindow >= 1000000
                        ? (selectedModelContextWindow / 1048576).toFixed(1) + 'M'
                        : Math.round(selectedModelContextWindow / 1024) + 'K'
                    }}
                  </span>
                </p>

                <div class="mt-2 flex items-center gap-2">
                  <button
                    v-if="canFetchModels"
                    class="flex items-center gap-1 rounded-md border border-dashed border-primary-300 px-2 py-1 text-xs text-primary-500 transition-colors hover:border-primary-400 hover:text-primary-600 dark:border-primary-700 dark:text-primary-400 dark:hover:border-primary-500"
                    @click="fetchRemoteModels"
                  >
                    <UIcon name="i-heroicons-cloud-arrow-down" class="h-3.5 w-3.5" />
                    {{ t('settings.aiConfig.modal.fetchModels') }}
                  </button>
                  <button
                    v-if="currentProviderDef?.supportsCustomModels"
                    class="flex items-center gap-1 rounded-md border border-dashed border-gray-300 px-2 py-1 text-xs text-gray-500 transition-colors hover:border-primary-400 hover:text-primary-500 dark:border-gray-600 dark:text-gray-400 dark:hover:border-primary-500 dark:hover:text-primary-400"
                    @click="openAddModelDialog"
                  >
                    <UIcon name="i-heroicons-plus" class="h-3.5 w-3.5" />
                    {{ t('settings.aiConfig.modal.addCustomModel') }}
                  </button>
                  <button
                    v-if="formData.model"
                    class="flex items-center gap-1 rounded-md border border-dashed border-gray-300 px-2 py-1 text-xs text-gray-500 transition-colors hover:border-primary-400 hover:text-primary-500 dark:border-gray-600 dark:text-gray-400 dark:hover:border-primary-500 dark:hover:text-primary-400"
                    @click="openEditModelDialog"
                  >
                    <UIcon name="i-heroicons-pencil-square" class="h-3.5 w-3.5" />
                    {{ t('settings.aiConfig.modal.editModel') }}
                  </button>
                  <button
                    v-if="selectedModelIsCustom"
                    class="flex items-center gap-1 rounded-md border border-dashed border-red-200 px-2 py-1 text-xs text-red-400 transition-colors hover:border-red-400 hover:text-red-500 dark:border-red-800 dark:hover:border-red-500"
                    @click="deleteCustomModel(formData.model)"
                  >
                    <UIcon name="i-heroicons-trash" class="h-3.5 w-3.5" />
                    {{ t('settings.aiConfig.modal.deleteCustomModel') }}
                  </button>
                </div>
              </div>
            </template>

            <!-- ===== 第三方 / 本地：API 接口类型 ===== -->
            <div v-if="!isPresetMode">
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.aiConfig.modal.apiFormat') }}
              </label>
              <UITabs v-model="formData.apiFormat" :items="apiFormatItems" size="xs" />
            </div>

            <!-- ===== 通用：自定义配置名称 ===== -->
            <template v-if="formData.provider || !isPresetMode">
              <div>
                <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('settings.aiConfig.modal.configName') }}
                  <span class="font-normal text-gray-400">{{ t('settings.aiConfig.modal.optional') }}</span>
                </label>
                <UInput
                  v-model="formData.customName"
                  class="w-full"
                  :placeholder="
                    isPresetMode
                      ? t('settings.aiConfig.modal.configNamePlaceholderPreset')
                      : t('settings.aiConfig.modal.configNamePlaceholderCustom')
                  "
                />
              </div>
            </template>

            <!-- ===== 通用：推理模型选项 ===== -->
            <template v-if="formData.provider || !isPresetMode">
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

              <div
                v-if="formData.isReasoningModel"
                class="flex items-center justify-between rounded-lg bg-gray-50 p-3 dark:bg-gray-800"
              >
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
            </template>
          </div>
        </div>

        <!-- 底部按钮 -->
        <div class="mt-4 flex shrink-0 justify-end gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
          <UButton variant="soft" @click="closeModal">{{ t('common.cancel') }}</UButton>
          <UButton color="primary" :disabled="!canSave" :loading="isSaving || isValidating" @click="saveConfig">
            {{ mode === 'add' ? t('common.add') : t('common.save') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>

  <!-- 验证失败确认弹窗 -->
  <UModal
    :open="showValidationFailConfirm"
    :ui="{ content: 'z-[102]', overlay: 'z-[101]' }"
    @update:open="showValidationFailConfirm = $event"
  >
    <template #content>
      <div class="p-6">
        <div class="mb-4 flex items-start gap-3">
          <UIcon name="i-heroicons-exclamation-triangle" class="mt-0.5 h-6 w-6 shrink-0 text-amber-500" />
          <div>
            <h4 class="font-medium text-gray-900 dark:text-white">
              {{ t('settings.aiConfig.modal.validationFailedTitle') }}
            </h4>
            <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">{{ validationFailMessage }}</p>
            <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {{ t('settings.aiConfig.modal.saveAnywayHint') }}
            </p>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <UButton variant="soft" @click="cancelSave">{{ t('common.cancel') }}</UButton>
          <UButton color="warning" @click="confirmSaveAnyway">
            {{ t('settings.aiConfig.modal.saveAnyway') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>

  <!-- 远程模型浏览弹窗 -->
  <RemoteModelBrowser
    v-model:open="showRemoteModelBrowser"
    :models="remoteModels"
    :loading="isFetchingModels"
    :error="remoteModelsError"
    :added-model-ids="addedModelIds"
    @add="addRemoteModel"
    @add-all="addAllRemoteModels"
    @refresh="fetchRemoteModels"
  />

  <!-- 添加自定义模型小弹窗 -->
  <UModal
    :open="showAddModelDialog"
    :ui="{ content: 'z-[102]', overlay: 'z-[101]' }"
    @update:open="showAddModelDialog = $event"
  >
    <template #content>
      <div class="p-5">
        <h4 class="mb-4 text-base font-semibold text-gray-900 dark:text-white">
          {{ t('settings.aiConfig.modal.addCustomModel') }}
        </h4>
        <div class="space-y-3">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.aiConfig.modal.customModelId') }}
            </label>
            <UInput v-model="newModelId" class="w-full" placeholder="gpt-4o-custom, deepseek-r1, ..." />
            <p class="mt-1 text-[10px] text-gray-400">
              {{ t('settings.aiConfig.modal.customModelIdHint') }}
            </p>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.aiConfig.modal.customModelDisplayName') }}
              <span class="font-normal text-gray-400">{{ t('settings.aiConfig.modal.optional') }}</span>
            </label>
            <UInput
              v-model="newModelName"
              class="w-full"
              :placeholder="newModelId || t('settings.aiConfig.modal.customModelDisplayNamePlaceholder')"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.aiConfig.modal.contextWindow') }}
            </label>
            <div class="flex items-center gap-2">
              <UInput
                :model-value="newModelContextWindow ?? ''"
                class="flex-1"
                type="number"
                :placeholder="t('settings.aiConfig.modal.contextWindowPlaceholder')"
                @update:model-value="newModelContextWindow = $event ? Number($event) : undefined"
              />
            </div>
            <div class="mt-1.5 flex flex-wrap gap-1">
              <button
                v-for="opt in [
                  { label: '64K', value: 65536 },
                  { label: '128K', value: 128000 },
                  { label: '200K', value: 200000 },
                  { label: '1M', value: 1048576 },
                ]"
                :key="opt.value"
                class="rounded border px-1.5 py-0.5 text-[10px] transition-colors"
                :class="[
                  newModelContextWindow === opt.value
                    ? 'border-primary-400 bg-primary-50 text-primary-600 dark:border-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600',
                ]"
                @click="newModelContextWindow = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
            <p class="mt-1 text-[10px] text-gray-400">
              {{ t('settings.aiConfig.modal.contextWindowHint') }}
            </p>
          </div>
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <UButton variant="soft" @click="showAddModelDialog = false">{{ t('common.cancel') }}</UButton>
          <UButton color="primary" :disabled="!newModelId.trim()" @click="confirmAddModel">
            {{ t('common.add') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>

  <!-- 编辑模型弹窗 -->
  <UModal
    :open="showEditModelDialog"
    :ui="{ content: 'z-[102]', overlay: 'z-[101]' }"
    @update:open="showEditModelDialog = $event"
  >
    <template #content>
      <div class="p-5">
        <h4 class="mb-4 text-base font-semibold text-gray-900 dark:text-white">
          {{ t('settings.aiConfig.modal.editModel') }}
        </h4>
        <div class="space-y-3">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.aiConfig.modal.customModelId') }}
            </label>
            <p class="text-sm text-gray-600 dark:text-gray-400">{{ formData.model }}</p>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.aiConfig.modal.contextWindow') }}
            </label>
            <div class="flex items-center gap-2">
              <UInput
                :model-value="editModelContextWindow ?? ''"
                class="flex-1"
                type="number"
                :placeholder="t('settings.aiConfig.modal.contextWindowPlaceholder')"
                @update:model-value="editModelContextWindow = $event ? Number($event) : undefined"
              />
            </div>
            <div class="mt-1.5 flex flex-wrap gap-1">
              <button
                v-for="opt in [
                  { label: '64K', value: 65536 },
                  { label: '128K', value: 128000 },
                  { label: '200K', value: 200000 },
                  { label: '1M', value: 1048576 },
                ]"
                :key="opt.value"
                class="rounded border px-1.5 py-0.5 text-[10px] transition-colors"
                :class="[
                  editModelContextWindow === opt.value
                    ? 'border-primary-400 bg-primary-50 text-primary-600 dark:border-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600',
                ]"
                @click="editModelContextWindow = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
            <p class="mt-1 text-[10px] text-gray-400">
              {{ t('settings.aiConfig.modal.contextWindowHint') }}
            </p>
          </div>
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <UButton variant="soft" @click="showEditModelDialog = false">{{ t('common.cancel') }}</UButton>
          <UButton color="primary" @click="confirmEditModel">
            {{ t('common.save') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
