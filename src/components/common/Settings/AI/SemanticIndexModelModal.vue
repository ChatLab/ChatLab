<script setup lang="ts">
/**
 * 语义索引向量模型配置弹窗
 *
 * 父组件以 v-model:open 控制开关，并通过 config/apiKeySet 传入当前已保存配置。
 * 弹窗内维护一份草稿：打开时从 config 初始化，确认时 emit('confirm') 回传草稿，
 * 取消/关闭则直接丢弃草稿（下次打开重新从 config 初始化）。落库与重建判定在父组件。
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UITabs from '@/components/UI/Tabs.vue'
import ApiKeyInput from './ApiKeyInput.vue'
import { LOCAL_MODELS, API_TEMPLATES, type ModelConfigDraft } from './semantic-index-models'
import { canReuseSemanticIndexApiAuthProfile, isSemanticIndexApiKeyRequired } from './semantic-index-config-builder'
import type { SemanticIndexConfig, SemanticIndexModelDownloadSource } from '@/services'

const props = defineProps<{
  open: boolean
  config: SemanticIndexConfig | null
  apiKeySet: boolean
  saving: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'confirm', payload: ModelConfigDraft): void
}>()

const { t, locale } = useI18n()

const mode = ref<'local' | 'api'>('local')
const localModelId = ref(LOCAL_MODELS[0].modelId)
const localDownloadSource = ref<SemanticIndexModelDownloadSource>('huggingface')
const apiTemplate = ref('openai-compatible')
const apiBaseUrl = ref('')
const apiModel = ref('')
const apiKey = ref('')

const isZh = computed(() => locale.value.startsWith('zh'))
const localModels = computed(() => LOCAL_MODELS.filter((m) => !m.zhOnly || isZh.value))
// 非中文 locale 隐藏中国区模板，但保留当前已选项避免标签错位
const apiTemplates = computed(() =>
  API_TEMPLATES.filter((tpl) => !tpl.zhOnly || isZh.value || tpl.id === apiTemplate.value)
)
const modeItems = computed(() => [
  { label: t('settings.ai.semanticIndex.modeLocal'), value: 'local' },
  { label: t('settings.ai.semanticIndex.modeApi'), value: 'api' },
])
const downloadSourceItems = computed(() => [
  { label: t('settings.ai.semanticIndex.downloadSourceOfficial'), value: 'huggingface' },
  { label: t('settings.ai.semanticIndex.downloadSourceMirror'), value: 'hf-mirror' },
])
const canReuseApiKey = computed(() =>
  canReuseSemanticIndexApiAuthProfile(props.config, apiBaseUrl.value, props.apiKeySet)
)
const apiKeyRequired = computed(() => isSemanticIndexApiKeyRequired(apiBaseUrl.value))

const hasModelConfig = computed(() => {
  if (mode.value === 'local') return !!localModelId.value
  return (
    !!apiBaseUrl.value.trim() &&
    !!apiModel.value.trim() &&
    (!apiKeyRequired.value || canReuseApiKey.value || !!apiKey.value.trim())
  )
})

function initDraft() {
  // config 为 null 表示尚未配置：默认不预选任何模型，确认需用户先选择
  const c = props.config
  mode.value = c?.mode ?? 'local'
  localModelId.value = c?.local.modelId ?? ''
  localDownloadSource.value = c?.local.downloadSource ?? 'huggingface'
  apiBaseUrl.value = c?.api?.baseUrl ?? ''
  apiModel.value = c?.api?.model ?? ''
  apiKey.value = ''
  const tpl = API_TEMPLATES.find((x) => x.baseUrl === c?.api?.baseUrl)
  apiTemplate.value = tpl?.id ?? 'openai-compatible'
}

watch(
  () => props.open,
  (open) => {
    if (open) initDraft()
  }
)

function onTemplateChange(id: string | number) {
  apiTemplate.value = String(id)
  const tpl = API_TEMPLATES.find((x) => x.id === apiTemplate.value)
  if (tpl && tpl.id !== 'openai-compatible') {
    apiBaseUrl.value = tpl.baseUrl
    apiModel.value = tpl.model
  }
}

function close() {
  emit('update:open', false)
}

function confirm() {
  if (!hasModelConfig.value) return
  emit('confirm', {
    mode: mode.value,
    localModelId: localModelId.value,
    localDownloadSource: localDownloadSource.value,
    apiBaseUrl: apiBaseUrl.value,
    apiModel: apiModel.value,
    apiKey: apiKey.value,
  })
}
</script>

<template>
  <UModal
    :open="open"
    :ui="{ content: 'z-[101] max-w-lg', overlay: 'z-[100]' }"
    @update:open="(v) => emit('update:open', v)"
  >
    <template #content>
      <div class="space-y-4 p-5">
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-base font-semibold text-gray-900 dark:text-white">
            {{ t('settings.ai.semanticIndex.modelModalTitle') }}
          </h3>
          <UITabs
            :model-value="mode"
            :items="modeItems"
            size="xs"
            @update:model-value="(v) => (mode = v as 'local' | 'api')"
          />
        </div>

        <!-- 本地模型 -->
        <div v-if="mode === 'local'" class="space-y-2">
          <div class="grid gap-2 sm:grid-cols-2">
            <button
              v-for="m in localModels"
              :key="m.modelId"
              type="button"
              class="flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition"
              :class="
                localModelId === m.modelId
                  ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
              "
              @click="localModelId = m.modelId"
            >
              <div class="flex w-full items-center justify-between">
                <span class="text-sm font-medium text-gray-900 dark:text-white">{{ m.name }}</span>
                <UBadge v-if="m.recommended" color="primary" variant="soft" size="xs">
                  {{ t('settings.ai.semanticIndex.recommended') }}
                </UBadge>
              </div>
              <span class="text-xs text-gray-500">
                {{ t('settings.ai.semanticIndex.approxSize', { mb: m.approxMB }) }}
              </span>
            </button>
          </div>
          <div class="space-y-1.5 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <label class="block text-xs font-medium text-gray-600 dark:text-gray-400">
              {{ t('settings.ai.semanticIndex.modelDownloadSource') }}
            </label>
            <UITabs
              :model-value="localDownloadSource"
              :items="downloadSourceItems"
              size="xs"
              @update:model-value="(v) => (localDownloadSource = v as SemanticIndexModelDownloadSource)"
            />
            <p v-if="localDownloadSource === 'hf-mirror'" class="text-xs text-amber-600 dark:text-amber-400">
              {{ t('settings.ai.semanticIndex.mirrorSourceHint') }}
            </p>
          </div>
          <p class="text-xs text-gray-400">{{ t('settings.ai.semanticIndex.localDownloadHint') }}</p>
        </div>

        <!-- API 模式 -->
        <div v-else class="space-y-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
              {{ t('settings.ai.semanticIndex.apiTemplate') }}
            </label>
            <UITabs
              :model-value="apiTemplate"
              :items="apiTemplates.map((x) => ({ label: x.label, value: x.id }))"
              size="xs"
              @update:model-value="onTemplateChange"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Base URL</label>
            <UInput v-model="apiBaseUrl" size="sm" class="w-full" placeholder="https://api.example.com/v1" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
              {{ t('settings.ai.semanticIndex.modelName') }}
            </label>
            <UInput v-model="apiModel" size="sm" class="w-full" placeholder="text-embedding-3-small" />
          </div>
          <ApiKeyInput
            v-model="apiKey"
            :placeholder="canReuseApiKey ? t('settings.ai.semanticIndex.apiKeySaved') : ''"
            :hint="t('settings.ai.semanticIndex.apiKeyHint')"
          />
          <p
            class="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-400"
          >
            {{ t('settings.ai.semanticIndex.apiCostWarning') }}
          </p>
        </div>

        <p class="text-xs text-gray-400">{{ t('settings.ai.semanticIndex.changeRebuildHint') }}</p>

        <div class="flex justify-end gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
          <UButton variant="ghost" :disabled="saving" @click="close">{{ t('common.cancel') }}</UButton>
          <UButton color="primary" :loading="saving" :disabled="!hasModelConfig" @click="confirm">
            {{ t('common.confirm') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
