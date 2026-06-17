<script setup lang="ts">
/**
 * 语义索引设置区块（设置 > AI > 语义索引）
 *
 * Phase 2 职责：向量模型配置（本地/API）、索引概览、已启用对话的管理操作
 * （建立/暂停/取消/重建/停用）、建立待处理索引、清理未使用索引。
 * 选择对话启用（批量选择）属于 Phase 3 的当前对话入口/弹窗。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import UITabs from '@/components/UI/Tabs.vue'
import ApiKeyInput from './ApiKeyInput.vue'
import SemanticIndexConversationPicker from './SemanticIndexConversationPicker.vue'
import {
  useDataService,
  useSemanticIndexService,
  SEARCH_MAX_RESULTS_MIN,
  SEARCH_MAX_RESULTS_MAX,
  SEARCH_MAX_RESULTS_DEFAULT,
} from '@/services'
import type { SemanticIndexConfig, SemanticIndexSessionStatus } from '@/services'

const { t, locale } = useI18n()
const service = useSemanticIndexService()

const LOCAL_MODELS = [
  {
    modelId: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
    name: 'Qwen3-Embedding-0.6B',
    approxMB: 593,
    recommended: true,
    zhOnly: false,
  },
  { modelId: 'Xenova/bge-small-zh-v1.5', name: 'BGE small zh', approxMB: 97, recommended: false, zhOnly: true },
]

interface ApiTemplate {
  id: string
  label: string
  baseUrl: string
  model: string
}
const API_TEMPLATES: ApiTemplate[] = [
  { id: 'openai-compatible', label: 'OpenAI Compatible', baseUrl: '', model: '' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small' },
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'nomic-embed-text' },
  {
    id: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'text-embedding-v3',
  },
  { id: 'zhipu', label: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'embedding-3' },
  { id: 'siliconflow', label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3' },
]

const isZh = computed(() => locale.value.startsWith('zh'))
const localModels = computed(() => LOCAL_MODELS.filter((m) => !m.zhOnly || isZh.value))

const modeItems = computed(() => [
  { label: t('settings.ai.semanticIndex.modeLocal'), value: 'local' },
  { label: t('settings.ai.semanticIndex.modeApi'), value: 'api' },
])

// 配置表单状态
const mode = ref<'local' | 'api'>('local')
const localModelId = ref(LOCAL_MODELS[0].modelId)
const apiTemplate = ref('openai-compatible')
const apiBaseUrl = ref('')
const apiModel = ref('')
const apiKey = ref('')
const apiKeySet = ref(false)
const saving = ref(false)
const savedConfig = ref<SemanticIndexConfig | null>(null)
const searchMaxResults = ref(SEARCH_MAX_RESULTS_DEFAULT)

function clampSearchMaxResults(value: number): number {
  if (!Number.isFinite(value)) return SEARCH_MAX_RESULTS_DEFAULT
  return Math.max(SEARCH_MAX_RESULTS_MIN, Math.min(SEARCH_MAX_RESULTS_MAX, Math.round(value)))
}

// 检索片段数变化后防抖落库（不触发重建，仅更新检索默认值）
let searchSaveTimer: ReturnType<typeof setTimeout> | null = null
function onSearchMaxResultsChange(value: number | null) {
  searchMaxResults.value = clampSearchMaxResults(value ?? SEARCH_MAX_RESULTS_DEFAULT)
  if (searchSaveTimer) clearTimeout(searchSaveTimer)
  searchSaveTimer = setTimeout(() => {
    if (savedConfig.value && searchMaxResults.value !== savedConfig.value.searchMaxResults) saveConfig()
  }, 600)
}

// 概览与会话状态
const enabledStatuses = ref<SemanticIndexSessionStatus[]>([])
const sessionNames = ref<Map<string, string>>(new Map())
const loading = ref(false)
const busySession = ref<string | null>(null)
const buildingPending = ref(false)
const cleaning = ref(false)
const showCleanupConfirm = ref(false)
const showPicker = ref(false)

const overview = computed(() => {
  const list = enabledStatuses.value
  let completed = 0
  let needsRebuild = 0
  let building = 0
  let pending = 0
  let failed = 0
  let indexedMessages = 0
  let totalMessages = 0
  for (const s of list) {
    indexedMessages += s.indexedMessages
    totalMessages += s.totalMessages
    if (s.needsRebuild) needsRebuild++
    else if (s.running || s.queued || s.indexStatus === 'running') building++
    else if (s.indexStatus === 'completed') completed++
    else if (s.indexStatus === 'failed') failed++
    else pending++
  }
  const coverage = totalMessages > 0 ? Math.round((indexedMessages / totalMessages) * 100) : 0
  return {
    enabled: list.length,
    completed,
    needsRebuild,
    building,
    pending,
    failed,
    indexedMessages,
    totalMessages,
    coverage,
  }
})

// 待处理 = 需重建 / 失败 / 未建立 / 暂停，且当前不在执行
const pendingCount = computed(
  () =>
    enabledStatuses.value.filter((s) => !s.running && !s.queued && (s.needsRebuild || s.indexStatus !== 'completed'))
      .length
)

const hasModelConfig = computed(() => {
  if (mode.value === 'local') return !!localModelId.value
  return !!apiBaseUrl.value.trim() && !!apiModel.value.trim() && (apiKeySet.value || !!apiKey.value.trim())
})

function applyConfigToForm(config: SemanticIndexConfig) {
  mode.value = config.mode
  searchMaxResults.value = clampSearchMaxResults(config.searchMaxResults ?? SEARCH_MAX_RESULTS_DEFAULT)
  localModelId.value = config.local.modelId || LOCAL_MODELS[0].modelId
  if (config.api) {
    apiBaseUrl.value = config.api.baseUrl
    apiModel.value = config.api.model
    const tpl = API_TEMPLATES.find((x) => x.baseUrl === config.api?.baseUrl)
    apiTemplate.value = tpl?.id ?? 'openai-compatible'
  }
}

function onTemplateChange(id: string | number) {
  apiTemplate.value = String(id)
  const tpl = API_TEMPLATES.find((x) => x.id === apiTemplate.value)
  if (tpl && tpl.id !== 'openai-compatible') {
    apiBaseUrl.value = tpl.baseUrl
    apiModel.value = tpl.model
  }
}

async function saveConfig() {
  saving.value = true
  try {
    const config: SemanticIndexConfig = {
      version: savedConfig.value?.version ?? 1,
      mode: mode.value,
      local: { modelId: localModelId.value },
      api: mode.value === 'api' ? { baseUrl: apiBaseUrl.value.trim(), model: apiModel.value.trim() } : null,
      searchMaxResults: clampSearchMaxResults(searchMaxResults.value),
    }
    const res = await service.setConfig(config, apiKey.value.trim() || undefined)
    savedConfig.value = res.config
    apiKeySet.value = res.apiKeySet
    apiKey.value = ''
    applyConfigToForm(res.config)
    await loadStatuses()
  } catch (error) {
    console.error('[semantic-index] save config failed:', error)
  } finally {
    saving.value = false
  }
}

const hasActiveBuild = computed(() => enabledStatuses.value.some(isRunning))

// 有任务运行中时静默轮询，实时反映各会话建立进度
let pollTimer: ReturnType<typeof setTimeout> | null = null
function clearPoll() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}
function schedulePoll() {
  clearPoll()
  if (!hasActiveBuild.value) return
  pollTimer = setTimeout(async () => {
    try {
      enabledStatuses.value = await service.listEnabled()
    } catch (error) {
      console.error('[semantic-index] poll statuses failed:', error)
    }
    schedulePoll()
  }, 1500)
}

async function loadStatuses() {
  loading.value = true
  try {
    const [statuses, sessions] = await Promise.all([service.listEnabled(), useDataService().getSessions()])
    enabledStatuses.value = statuses
    sessionNames.value = new Map(sessions.map((s) => [s.id, s.name]))
  } catch (error) {
    console.error('[semantic-index] load statuses failed:', error)
  } finally {
    loading.value = false
  }
  schedulePoll()
}

async function runSession(action: 'build' | 'pause' | 'cancel' | 'rebuild' | 'disable', sessionId: string) {
  busySession.value = sessionId
  try {
    await service[action](sessionId)
    await loadStatuses()
  } catch (error) {
    console.error(`[semantic-index] ${action} failed:`, error)
  } finally {
    busySession.value = null
  }
}

async function buildPending() {
  buildingPending.value = true
  try {
    enabledStatuses.value = await service.buildPending()
    schedulePoll()
  } catch (error) {
    console.error('[semantic-index] build pending failed:', error)
  } finally {
    buildingPending.value = false
  }
}

async function confirmCleanup() {
  showCleanupConfirm.value = false
  cleaning.value = true
  try {
    await service.cleanup()
    await loadStatuses()
  } catch (error) {
    console.error('[semantic-index] cleanup failed:', error)
  } finally {
    cleaning.value = false
  }
}

function statusBadge(s: SemanticIndexSessionStatus): { label: string; color: string } {
  const k = 'settings.ai.semanticIndex.state'
  if (s.needsRebuild) return { label: t(`${k}.needsRebuild`), color: 'text-amber-600 dark:text-amber-400' }
  if (s.running || s.queued || s.indexStatus === 'running')
    return { label: t(`${k}.building`), color: 'text-blue-600 dark:text-blue-400' }
  if (s.indexStatus === 'completed') return { label: t(`${k}.completed`), color: 'text-green-600 dark:text-green-400' }
  if (s.indexStatus === 'failed') return { label: t(`${k}.failed`), color: 'text-red-600 dark:text-red-400' }
  if (s.indexStatus === 'paused') return { label: t(`${k}.paused`), color: 'text-gray-500' }
  return { label: t(`${k}.pending`), color: 'text-gray-500' }
}

function isRunning(s: SemanticIndexSessionStatus): boolean {
  return s.running || s.queued || s.indexStatus === 'running'
}

const sectionRef = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
let loaded = false

onMounted(async () => {
  try {
    const res = await service.getConfig()
    savedConfig.value = res.config
    apiKeySet.value = res.apiKeySet
    applyConfigToForm(res.config)
  } catch (error) {
    console.error('[semantic-index] load config failed:', error)
  }

  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && !loaded) {
        loaded = true
        loadStatuses()
        observer?.disconnect()
      }
    },
    { threshold: 0.1 }
  )
  if (sectionRef.value) observer.observe(sectionRef.value)
})

onUnmounted(() => {
  observer?.disconnect()
  clearPoll()
  if (searchSaveTimer) clearTimeout(searchSaveTimer)
})
</script>

<template>
  <div ref="sectionRef" class="space-y-6">
    <div>
      <h3 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-circle-stack" class="h-4 w-4 text-blue-500" />
        {{ t('settings.ai.semanticIndex.title') }}
      </h3>
      <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
        {{ t('settings.ai.semanticIndex.description') }}
      </p>
    </div>

    <!-- 向量模型 -->
    <div class="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
          {{ t('settings.ai.semanticIndex.vectorModel') }}
        </span>
        <UITabs
          :model-value="mode"
          :items="modeItems"
          size="xs"
          @update:model-value="(v) => (mode = v as 'local' | 'api')"
        />
      </div>

      <!-- 本地模型 -->
      <div v-if="mode === 'local'" class="grid gap-2 sm:grid-cols-2">
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
          <span class="text-xs text-gray-500">{{ t('settings.ai.semanticIndex.approxSize', { mb: m.approxMB }) }}</span>
        </button>
      </div>
      <p v-if="mode === 'local'" class="text-xs text-gray-400">
        {{ t('settings.ai.semanticIndex.localDownloadHint') }}
      </p>

      <!-- API 模式 -->
      <div v-else class="space-y-3">
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            {{ t('settings.ai.semanticIndex.apiTemplate') }}
          </label>
          <USelect
            :model-value="apiTemplate"
            :items="API_TEMPLATES.map((x) => ({ label: x.label, value: x.id }))"
            size="sm"
            @update:model-value="onTemplateChange"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Base URL</label>
          <UInput v-model="apiBaseUrl" size="sm" placeholder="https://api.example.com/v1" />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            {{ t('settings.ai.semanticIndex.modelName') }}
          </label>
          <UInput v-model="apiModel" size="sm" placeholder="text-embedding-3-small" />
        </div>
        <ApiKeyInput
          v-model="apiKey"
          :placeholder="apiKeySet ? t('settings.ai.semanticIndex.apiKeySaved') : ''"
          :hint="t('settings.ai.semanticIndex.apiKeyHint')"
        />
        <p
          class="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-400"
        >
          {{ t('settings.ai.semanticIndex.apiCostWarning') }}
        </p>
      </div>

      <div class="flex items-center justify-between border-t border-gray-200 pt-3 dark:border-gray-700">
        <span class="text-xs text-gray-400">{{ t('settings.ai.semanticIndex.changeRebuildHint') }}</span>
        <UButton size="xs" color="primary" :loading="saving" :disabled="!hasModelConfig" @click="saveConfig">
          {{ t('common.save') }}
        </UButton>
      </div>
    </div>

    <!-- AI 检索参数 -->
    <div class="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ t('settings.ai.semanticIndex.searchMaxResults.label') }}
          </span>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {{ t('settings.ai.semanticIndex.searchMaxResults.hint') }}
          </p>
        </div>
        <UInputNumber
          :min="SEARCH_MAX_RESULTS_MIN"
          :max="SEARCH_MAX_RESULTS_MAX"
          :model-value="searchMaxResults"
          size="sm"
          class="w-28 shrink-0"
          @update:model-value="onSearchMaxResultsChange"
        />
      </div>
    </div>

    <!-- 索引概览 -->
    <div class="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
          {{ t('settings.ai.semanticIndex.overview') }}
        </span>
        <UButton icon="i-heroicons-arrow-path" variant="ghost" size="xs" :loading="loading" @click="loadStatuses" />
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span class="text-gray-500">
          {{ t('settings.ai.semanticIndex.enabledCount', { count: overview.enabled }) }}
        </span>
        <span class="text-green-600 dark:text-green-400">
          {{ t('settings.ai.semanticIndex.state.completed') }} {{ overview.completed }}
        </span>
        <span v-if="overview.building > 0" class="text-blue-600 dark:text-blue-400">
          {{ t('settings.ai.semanticIndex.state.building') }} {{ overview.building }}
        </span>
        <span v-if="overview.pending > 0" class="text-gray-500">
          {{ t('settings.ai.semanticIndex.state.pending') }} {{ overview.pending }}
        </span>
        <span v-if="overview.needsRebuild > 0" class="text-amber-600 dark:text-amber-400">
          {{ t('settings.ai.semanticIndex.state.needsRebuild') }} {{ overview.needsRebuild }}
        </span>
        <span v-if="overview.failed > 0" class="text-red-600 dark:text-red-400">
          {{ t('settings.ai.semanticIndex.state.failed') }} {{ overview.failed }}
        </span>
        <span class="text-gray-500">{{ t('settings.ai.semanticIndex.coverage', { percent: overview.coverage }) }}</span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <UButton size="xs" variant="soft" icon="i-heroicons-check-circle" @click="showPicker = true">
          {{ t('settings.ai.semanticIndex.selectConversations') }}
        </UButton>
        <UButton
          size="xs"
          color="primary"
          :loading="buildingPending"
          :disabled="!hasModelConfig || pendingCount === 0"
          @click="buildPending"
        >
          {{ t('settings.ai.semanticIndex.buildPending') }}
        </UButton>
        <UButton size="xs" variant="soft" :loading="cleaning" @click="showCleanupConfirm = true">
          {{ t('settings.ai.semanticIndex.cleanup') }}
        </UButton>
        <span v-if="!hasModelConfig" class="text-xs text-amber-500">
          {{ t('settings.ai.semanticIndex.configFirst') }}
        </span>
      </div>
    </div>

    <!-- 已启用对话列表 -->
    <div v-if="enabledStatuses.length > 0" class="space-y-2">
      <span class="text-xs font-medium text-gray-500">{{ t('settings.ai.semanticIndex.enabledSessions') }}</span>
      <div
        v-for="s in enabledStatuses"
        :key="s.sessionId"
        class="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700"
      >
        <div class="min-w-0">
          <div class="truncate text-sm text-gray-800 dark:text-gray-200">
            {{ sessionNames.get(s.sessionId) || s.sessionId }}
          </div>
          <div class="flex items-center gap-2 text-xs">
            <span :class="statusBadge(s).color">{{ statusBadge(s).label }}</span>
            <span v-if="s.error" class="truncate text-red-500" :title="s.error">{{ s.error }}</span>
          </div>
          <div v-if="isRunning(s)" class="mt-1 flex items-center gap-2">
            <div class="h-1.5 max-w-[160px] flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                class="h-full rounded-full bg-blue-500 transition-all duration-500"
                :style="{
                  width: `${s.totalMessages > 0 ? Math.round((s.indexedMessages / s.totalMessages) * 100) : 0}%`,
                }"
              />
            </div>
            <span class="shrink-0 text-[11px] text-gray-400">{{ s.indexedMessages }}/{{ s.totalMessages }}</span>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <template v-if="isRunning(s)">
            <UButton
              size="xs"
              variant="ghost"
              :loading="busySession === s.sessionId"
              @click="runSession('pause', s.sessionId)"
            >
              {{ t('settings.ai.semanticIndex.action.pause') }}
            </UButton>
            <UButton
              size="xs"
              variant="ghost"
              color="error"
              :disabled="busySession === s.sessionId"
              @click="runSession('cancel', s.sessionId)"
            >
              {{ t('settings.ai.semanticIndex.action.cancel') }}
            </UButton>
          </template>
          <template v-else-if="s.indexStatus === 'completed' && !s.needsRebuild">
            <UButton
              size="xs"
              variant="ghost"
              :loading="busySession === s.sessionId"
              @click="runSession('rebuild', s.sessionId)"
            >
              {{ t('settings.ai.semanticIndex.action.rebuild') }}
            </UButton>
          </template>
          <template v-else-if="s.needsRebuild">
            <UButton
              size="xs"
              variant="ghost"
              :loading="busySession === s.sessionId"
              @click="runSession('rebuild', s.sessionId)"
            >
              {{ t('settings.ai.semanticIndex.action.rebuild') }}
            </UButton>
          </template>
          <template v-else>
            <UButton
              size="xs"
              variant="ghost"
              :loading="busySession === s.sessionId"
              @click="runSession('build', s.sessionId)"
            >
              {{ t('settings.ai.semanticIndex.action.build') }}
            </UButton>
          </template>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            :disabled="busySession === s.sessionId"
            @click="runSession('disable', s.sessionId)"
          >
            {{ t('settings.ai.semanticIndex.action.disable') }}
          </UButton>
        </div>
      </div>
    </div>

    <!-- 对话选择 -->
    <SemanticIndexConversationPicker v-model="showPicker" :api-mode="mode === 'api'" @saved="loadStatuses" />

    <!-- 清理确认 -->
    <UModal v-model:open="showCleanupConfirm" :ui="{ content: 'z-[101]', overlay: 'z-[100]' }">
      <template #content>
        <div class="p-5">
          <div class="mb-4 flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <UIcon name="i-heroicons-trash" class="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ t('settings.ai.semanticIndex.cleanup') }}
            </h3>
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ t('settings.ai.semanticIndex.cleanupConfirm') }}
          </p>
          <div class="mt-5 flex justify-end gap-2">
            <UButton variant="ghost" @click="showCleanupConfirm = false">{{ t('common.cancel') }}</UButton>
            <UButton color="error" @click="confirmCleanup">{{ t('settings.ai.semanticIndex.cleanup') }}</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
