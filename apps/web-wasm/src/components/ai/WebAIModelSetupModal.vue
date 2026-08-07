<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  SaveWebModelConfigInput,
  WebAIConnectionTestResult,
  WebModelConfig,
  WebAIProvider,
} from '@openchatlab/web-ai-runtime'
import { resetProviderFields } from './model-config-form'

const props = defineProps<{
  open: boolean
  config: WebModelConfig | null
  testing?: boolean
  saving?: boolean
  removing?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  test: [input: SaveWebModelConfigInput]
  save: [input: SaveWebModelConfigInput]
  remove: []
}>()

const { t } = useI18n()
const result = ref<WebAIConnectionTestResult | null>(null)
const form = reactive<SaveWebModelConfigInput>({
  provider: 'deepseek',
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  apiKey: '',
})

const providerOptions = [
  { label: 'DeepSeek', value: 'deepseek' },
  { label: t('webAI.config.openAICompatible'), value: 'openai-compatible' },
]
const localizedErrorCodes = new Set(['AUTH', 'RATE_LIMIT', 'MODEL_NOT_FOUND', 'TIMEOUT', 'NETWORK_OR_CORS'])
const resultText = computed(() => {
  if (result.value?.ok) return t('webAI.config.testSuccess', { ms: result.value.latencyMs })
  const error = result.value?.error
  if (error && localizedErrorCodes.has(error.code)) return t(`webAI.errors.${error.code}`)
  return error?.message ?? ''
})

watch(
  [() => props.open, () => props.config] as const,
  ([open]) => {
    if (!open) return
    result.value = null
    form.provider = props.config?.provider ?? 'deepseek'
    form.baseURL = props.config?.baseURL ?? 'https://api.deepseek.com'
    form.model = props.config?.model ?? 'deepseek-v4-flash'
    form.apiKey = ''
  },
  { immediate: true }
)

function updateProvider(provider: string) {
  if (provider !== 'deepseek' && provider !== 'openai-compatible') return
  form.provider = provider
  resetProviderFields(form, provider)
  result.value = null
}

function getInput(): SaveWebModelConfigInput | null {
  if ((!props.config && !form.apiKey.trim()) || !form.model.trim() || !form.baseURL?.trim()) {
    result.value = {
      ok: false,
      error: { code: 'NOT_CONFIGURED', message: t('webAI.config.required'), retryable: false },
    }
    return null
  }
  return {
    provider: form.provider as WebAIProvider,
    baseURL: form.baseURL.trim(),
    model: form.model.trim(),
    apiKey: form.apiKey.trim(),
  }
}

function testConnection() {
  const input = getInput()
  if (input) emit('test', input)
}

function save() {
  const input = getInput()
  if (input) emit('save', input)
}

defineExpose({
  setTestResult(value: WebAIConnectionTestResult) {
    result.value = value
  },
})
</script>

<template>
  <UModal
    :open="open"
    :title="t('webAI.config.title')"
    :ui="{ content: 'z-[102] sm:max-w-lg', overlay: 'z-[101]' }"
    @update:open="emit('update:open', $event)"
  >
    <template #content>
      <div class="w-full max-w-lg bg-white p-5 dark:bg-page-dark">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('webAI.config.title') }}</h2>
            <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{{ t('webAI.config.description') }}</p>
          </div>
          <UButton
            icon="i-heroicons-x-mark"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="t('common.close')"
            @click="emit('update:open', false)"
          />
        </div>

        <div class="mt-5 space-y-4">
          <UFormField :label="t('webAI.config.provider')">
            <USelect
              :model-value="form.provider"
              class="w-full"
              :items="providerOptions"
              value-key="value"
              @update:model-value="updateProvider"
            />
          </UFormField>
          <UFormField :label="t('webAI.config.baseURL')">
            <UInput v-model="form.baseURL" class="w-full" autocomplete="url" />
          </UFormField>
          <UFormField :label="t('webAI.config.model')">
            <UInput v-model="form.model" class="w-full" autocomplete="off" />
          </UFormField>
          <UFormField :label="t('webAI.config.apiKey')">
            <UInput
              v-model="form.apiKey"
              class="w-full"
              type="password"
              autocomplete="off"
              :placeholder="config ? t('webAI.config.apiKeyReplace') : t('webAI.config.apiKeyPlaceholder')"
            />
          </UFormField>

          <div
            class="rounded-lg bg-gray-50 px-3 py-2.5 text-xs leading-5 text-gray-500 dark:bg-gray-800/50 dark:text-gray-400"
          >
            <p>{{ t('webAI.config.keyStorageWarning') }}</p>
            <p class="mt-1">{{ t('webAI.config.corsWarning') }}</p>
          </div>

          <div
            v-if="result"
            class="rounded-lg px-3 py-2 text-xs"
            :class="
              result.ok
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
            "
          >
            {{ resultText }}
          </div>
        </div>

        <div class="mt-5 flex items-center justify-between gap-3">
          <UButton
            v-if="config"
            color="error"
            variant="ghost"
            :disabled="testing || saving"
            :loading="removing"
            @click="emit('remove')"
          >
            {{ t('webAI.config.remove') }}
          </UButton>
          <span v-else />
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="soft"
              :disabled="saving || removing"
              :loading="testing"
              @click="testConnection"
            >
              {{ t('webAI.config.test') }}
            </UButton>
            <UButton color="primary" :disabled="testing || removing" :loading="saving" @click="save">
              {{ t('common.save') }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
