<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { EmbeddingServiceConfig, EmbeddingServiceConfigDisplay } from '@electron/preload/index'

const { t } = useI18n()

// ============ Props & Emits ============

const props = defineProps<{
  open: boolean
  mode: 'add' | 'edit'
  config: EmbeddingServiceConfigDisplay | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

// ============ 状态 ============

const isValidating = ref(false)
const isSaving = ref(false)

const formData = ref({
  name: '',
  apiSource: 'reuse_llm' as 'reuse_llm' | 'custom',
  model: '',
  baseUrl: '',
  apiKey: '',
})

const validationResult = ref<'idle' | 'valid' | 'invalid'>('idle')
const validationMessage = ref('')

// ============ 计算属性 ============

const isOpen = computed({
  get: () => props.open,
  set: (val) => emit('update:open', val),
})

const modalTitle = computed(() =>
  props.mode === 'add' ? t('settings.embedding.addConfig') : t('settings.embedding.editConfig')
)

const canSave = computed(() => {
  if (!formData.value.name.trim()) return false
  if (!formData.value.model.trim()) return false
  if (formData.value.apiSource === 'custom' && !formData.value.baseUrl.trim()) return false
  return true
})

// API 来源选项
const apiSourceOptions = computed(() => [
  { label: t('settings.embedding.reuseLLM'), value: 'reuse_llm' },
  { label: t('settings.embedding.customAPI'), value: 'custom' },
])

// ============ 监听 ============

watch(
  () => props.open,
  async (open) => {
    if (open) {
      validationResult.value = 'idle'
      validationMessage.value = ''

      if (props.mode === 'edit' && props.config) {
        // 编辑模式：加载完整配置
        const fullConfig = await window.embeddingApi.getConfig(props.config.id)
        if (fullConfig) {
          formData.value = {
            name: fullConfig.name,
            apiSource: fullConfig.apiSource,
            model: fullConfig.model,
            baseUrl: fullConfig.baseUrl || '',
            apiKey: fullConfig.apiKey || '',
          }
        }
      } else {
        // 新增模式：重置表单
        formData.value = {
          name: '',
          apiSource: 'reuse_llm',
          model: '',
          baseUrl: '',
          apiKey: '',
        }
      }
    }
  }
)

// ============ 方法 ============

async function validateConfig() {
  isValidating.value = true
  validationResult.value = 'idle'
  validationMessage.value = ''

  try {
    const testConfig: EmbeddingServiceConfig = {
      id: 'test',
      name: formData.value.name,
      apiSource: formData.value.apiSource,
      model: formData.value.model,
      baseUrl: formData.value.baseUrl || undefined,
      apiKey: formData.value.apiKey || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const result = await window.embeddingApi.validateConfig(testConfig)

    if (result.success) {
      validationResult.value = 'valid'
      validationMessage.value = t('settings.embedding.validateSuccess')
    } else {
      validationResult.value = 'invalid'
      validationMessage.value = result.error || t('settings.embedding.validateFailed')
    }
  } catch (error) {
    validationResult.value = 'invalid'
    validationMessage.value = String(error)
  } finally {
    isValidating.value = false
  }
}

async function saveConfig() {
  if (!canSave.value) return

  isSaving.value = true

  try {
    const configData = {
      name: formData.value.name.trim(),
      apiSource: formData.value.apiSource,
      model: formData.value.model.trim(),
      baseUrl: formData.value.apiSource === 'custom' ? formData.value.baseUrl.trim() : undefined,
      apiKey: formData.value.apiSource === 'custom' ? formData.value.apiKey.trim() || undefined : undefined,
    }

    let result: { success: boolean; error?: string }

    if (props.mode === 'edit' && props.config) {
      result = await window.embeddingApi.updateConfig(props.config.id, configData)
    } else {
      result = await window.embeddingApi.addConfig(configData)
    }

    if (result.success) {
      emit('saved')
      isOpen.value = false
    } else {
      validationResult.value = 'invalid'
      validationMessage.value = result.error || t('settings.embedding.saveFailed')
    }
  } catch (error) {
    validationResult.value = 'invalid'
    validationMessage.value = String(error)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal v-model:open="isOpen">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ modalTitle }}
            </h3>
            <UButton icon="i-heroicons-x-mark" color="neutral" variant="ghost" size="sm" @click="isOpen = false" />
          </div>
        </template>

        <div class="space-y-4">
          <!-- 配置名称 -->
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.embedding.configName') }}
              <span class="text-red-500">*</span>
            </label>
            <UInput
              v-model="formData.name"
              :placeholder="t('settings.embedding.configNamePlaceholder')"
              class="w-full"
            />
          </div>

          <!-- API 来源 -->
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.embedding.apiSource') }}
            </label>
            <USelectMenu v-model="formData.apiSource" :items="apiSourceOptions" value-key="value" class="w-full" />
            <p class="mt-1 text-xs text-gray-500">
              {{ t('settings.embedding.apiSourceHint') }}
            </p>
          </div>

          <!-- 模型名称 -->
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.embedding.model') }}
              <span class="text-red-500">*</span>
            </label>
            <UInput v-model="formData.model" :placeholder="t('settings.embedding.modelPlaceholder')" class="w-full" />
            <p class="mt-1 text-xs text-gray-500">
              {{ t('settings.embedding.modelHint') }}
            </p>
          </div>

          <!-- 自定义 API 配置 -->
          <template v-if="formData.apiSource === 'custom'">
            <!-- API 端点 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.embedding.baseUrl') }}
                <span class="text-red-500">*</span>
              </label>
              <UInput
                v-model="formData.baseUrl"
                :placeholder="t('settings.embedding.baseUrlPlaceholder')"
                class="w-full"
              />
            </div>

            <!-- API Key -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.embedding.apiKey') }}
                <span class="font-normal text-gray-400">{{ t('settings.embedding.optional') }}</span>
              </label>
              <UInput
                v-model="formData.apiKey"
                type="password"
                :placeholder="t('settings.embedding.apiKeyPlaceholder')"
                class="w-full"
              />
            </div>
          </template>

          <!-- 验证结果 -->
          <div
            v-if="validationResult !== 'idle'"
            :class="[
              'rounded-lg p-3 text-sm',
              validationResult === 'valid'
                ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
            ]"
          >
            {{ validationMessage }}
          </div>
        </div>

        <template #footer>
          <div class="flex justify-between">
            <UButton
              color="neutral"
              variant="soft"
              :loading="isValidating"
              :disabled="!canSave"
              @click="validateConfig"
            >
              {{ t('settings.embedding.validate') }}
            </UButton>
            <div class="flex gap-2">
              <UButton color="neutral" variant="ghost" @click="isOpen = false">
                {{ t('common.cancel') }}
              </UButton>
              <UButton color="primary" :loading="isSaving" :disabled="!canSave" @click="saveConfig">
                {{ t('common.save') }}
              </UButton>
            </div>
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
