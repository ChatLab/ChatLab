<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { toRefs } from 'vue'
import UITabs from '@/components/UI/Tabs.vue'
import AlertTips from './AlertTips.vue'
import ApiKeyInput from './ApiKeyInput.vue'
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
  canSave,
  modalTitle,
  selectProvider,
  onConnectionModeChange,
  openAddModelDialog,
  confirmAddModel,
  deleteCustomModel,
  validateKey,
  saveConfig,
  confirmSaveAnyway,
  cancelSave,
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
  <UModal :open="open" :ui="{ content: 'max-w-2xl' }" @update:open="emit('update:open', $event)">
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
              </div>

              <!-- 模型选择 -->
              <div>
                <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('settings.aiConfig.modal.model') }}
                </label>

                <UITabs v-if="modelTabItems.length > 0" v-model="formData.model" :items="modelTabItems" size="xs" />
                <p v-if="formData.model" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {{ t('settings.aiConfig.modal.customModelId') }}: {{ formData.model }}
                </p>

                <div class="mt-2 flex items-center gap-2">
                  <button
                    v-if="currentProviderDef?.supportsCustomModels"
                    class="text-xs text-primary-500 hover:underline"
                    @click="openAddModelDialog"
                  >
                    + {{ t('settings.aiConfig.modal.addCustomModel') }}
                  </button>
                  <button
                    v-if="selectedModelIsCustom"
                    class="text-xs text-red-400 hover:text-red-500 hover:underline"
                    @click="deleteCustomModel(formData.model)"
                  >
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
                  <UInput v-model="formData.baseUrl" placeholder="http://localhost:11434/v1" class="flex-1" />
                  <UButton :loading="isValidating" :disabled="!formData.baseUrl" variant="soft" @click="validateKey">
                    {{ t('settings.aiConfig.modal.validate') }}
                  </UButton>
                </div>
              </div>

              <!-- 模型选择 -->
              <div>
                <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('settings.aiConfig.modal.model') }}
                </label>

                <UITabs v-if="modelTabItems.length > 0" v-model="formData.model" :items="modelTabItems" size="xs" />
                <p v-if="formData.model" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {{ t('settings.aiConfig.modal.customModelId') }}: {{ formData.model }}
                </p>

                <div class="mt-2 flex items-center gap-2">
                  <button
                    v-if="currentProviderDef?.supportsCustomModels"
                    class="text-xs text-primary-500 hover:underline"
                    @click="openAddModelDialog"
                  >
                    + {{ t('settings.aiConfig.modal.addCustomModel') }}
                  </button>
                  <button
                    v-if="selectedModelIsCustom"
                    class="text-xs text-red-400 hover:text-red-500 hover:underline"
                    @click="deleteCustomModel(formData.model)"
                  >
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
                <UInput v-model="formData.baseUrl" class="w-full" placeholder="https://api.example.com/v1" />
                <p class="mt-1 text-xs text-gray-500">{{ t('settings.aiConfig.modal.apiEndpointHint') }}</p>
              </div>

              <!-- 模型选择 -->
              <div>
                <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('settings.aiConfig.modal.model') }}
                </label>

                <UITabs v-if="modelTabItems.length > 0" v-model="formData.model" :items="modelTabItems" size="xs" />
                <p v-if="formData.model" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {{ t('settings.aiConfig.modal.customModelId') }}: {{ formData.model }}
                </p>

                <div class="mt-2 flex items-center gap-2">
                  <button
                    v-if="currentProviderDef?.supportsCustomModels"
                    class="text-xs text-primary-500 hover:underline"
                    @click="openAddModelDialog"
                  >
                    + {{ t('settings.aiConfig.modal.addCustomModel') }}
                  </button>
                  <button
                    v-if="selectedModelIsCustom"
                    class="text-xs text-red-400 hover:text-red-500 hover:underline"
                    @click="deleteCustomModel(formData.model)"
                  >
                    {{ t('settings.aiConfig.modal.deleteCustomModel') }}
                  </button>
                </div>
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
  <UModal :open="showValidationFailConfirm" @update:open="showValidationFailConfirm = $event">
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

  <!-- 添加自定义模型小弹窗 -->
  <UModal :open="showAddModelDialog" @update:open="showAddModelDialog = $event">
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
</template>
