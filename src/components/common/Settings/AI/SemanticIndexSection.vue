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
import SemanticIndexConversationPicker from './SemanticIndexConversationPicker.vue'
import SemanticIndexModelModal from './SemanticIndexModelModal.vue'
import { LOCAL_MODELS, type ModelConfigDraft } from './semantic-index-models'
import { buildSemanticIndexModelConfig, isSemanticIndexApiKeyRequired } from './semantic-index-config-builder'
import { useDataService, useSemanticIndexService } from '@/services'
import type { ModelDownloadStatus, SemanticIndexConfig, SemanticIndexSessionStatus } from '@/services'

const { t } = useI18n()
const service = useSemanticIndexService()

// 配置状态（模型选择交互移入 SemanticIndexModelModal，本组件只保留已保存配置与展示）
// configured 区分「用户已显式选择模型」与「后端默认兜底配置」，默认不预选任何模型
const apiKeySet = ref(false)
const configured = ref(false)
const enabled = ref(true)
const saving = ref(false)
const savedConfig = ref<SemanticIndexConfig | null>(null)
const modelStatus = ref<ModelDownloadStatus>('idle')
const showModelModal = ref(false)

let modelPollTimer: ReturnType<typeof setInterval> | null = null

function startModelStatusPoll() {
  if (modelPollTimer) return
  modelPollTimer = setInterval(async () => {
    try {
      const res = await service.getConfig()
      modelStatus.value = res.modelStatus
      if (res.modelStatus !== 'downloading') stopModelStatusPoll()
    } catch {
      stopModelStatusPoll()
    }
  }, 2000)
}

function stopModelStatusPoll() {
  if (modelPollTimer) {
    clearInterval(modelPollTimer)
    modelPollTimer = null
  }
}

const isApiMode = computed(() => configured.value && savedConfig.value?.mode === 'api')

const hasModelConfig = computed(() => {
  const c = savedConfig.value
  if (!configured.value || !c) return false
  if (c.mode === 'local') return !!c.local.modelId
  return !!c.api?.baseUrl && !!c.api?.model && (!isSemanticIndexApiKeyRequired(c.api.baseUrl) || apiKeySet.value)
})

// 摘要行展示的当前模型：本地查展示名，API 显示模型名与服务地址 host；未配置时为 null
const currentModel = computed(() => {
  const c = savedConfig.value
  if (!configured.value || !c) return null
  if (c.mode === 'local') {
    const m = LOCAL_MODELS.find((x) => x.modelId === c.local.modelId)
    return { type: t('settings.ai.semanticIndex.modeLocal'), name: m?.name ?? c.local.modelId, sub: '' }
  }
  let host = c.api?.baseUrl ?? ''
  try {
    host = new URL(host).host
  } catch {
    /* 非法 URL 时退回原始字符串 */
  }
  return { type: t('settings.ai.semanticIndex.modeApi'), name: c.api?.model ?? '', sub: host }
})

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

// 待处理 = 需重建 / 失败 / 未建立 / 暂停 / 有新消息，且当前不在执行
const pendingCount = computed(
  () =>
    enabledStatuses.value.filter(
      (s) => !s.running && !s.queued && (s.needsRebuild || s.indexStatus !== 'completed' || !!s.hasNewMessages)
    ).length
)

async function persistConfig(next: SemanticIndexConfig, apiKey?: string): Promise<boolean> {
  saving.value = true
  try {
    const res = await service.setConfig(next, apiKey)
    savedConfig.value = res.config
    apiKeySet.value = res.apiKeySet
    configured.value = res.configured
    enabled.value = res.config.enabled
    modelStatus.value = res.modelStatus
    if (res.modelStatus === 'downloading') startModelStatusPoll()
    await loadStatuses()
    return true
  } catch (error) {
    console.error('[semantic-index] save config failed:', error)
    return false
  } finally {
    saving.value = false
  }
}

async function onModelConfirm(payload: ModelConfigDraft) {
  const next = buildSemanticIndexModelConfig(savedConfig.value, payload)
  if (await persistConfig(next, payload.apiKey.trim() || undefined)) showModelModal.value = false
}

// 切换全局开关：仅改 enabled，保留已选模型与其余配置
async function onToggleEnabled(value: boolean) {
  const base = savedConfig.value
  if (!base || base.enabled === value) return
  await persistConfig({ ...base, enabled: value })
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
    configured.value = res.configured
    enabled.value = res.config.enabled
    modelStatus.value = res.modelStatus
    if (res.modelStatus === 'downloading') startModelStatusPoll()
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
  stopModelStatusPoll()
})
</script>

<template>
  <div ref="sectionRef" class="space-y-6">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <UIcon name="i-heroicons-circle-stack" class="h-4 w-4 text-blue-500" />
          {{ t('settings.ai.semanticIndex.title') }}
        </h3>
        <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {{ t('settings.ai.semanticIndex.description') }}
        </p>
      </div>
      <USwitch :model-value="enabled" :loading="saving" class="mt-0.5 shrink-0" @update:model-value="onToggleEnabled" />
    </div>

    <!-- 关闭后整个模块内容隐藏，仅保留上方标题行与开关用于重新启用 -->
    <template v-if="enabled">
      <!-- 向量模型 -->
      <div class="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.ai.semanticIndex.vectorModel') }}
            </span>
            <div class="mt-0.5 flex min-w-0 items-center gap-2 text-xs">
              <template v-if="currentModel">
                <UBadge :color="isApiMode ? 'neutral' : 'primary'" variant="soft" size="xs">
                  {{ currentModel.type }}
                </UBadge>
                <span class="truncate text-gray-700 dark:text-gray-300">{{ currentModel.name }}</span>
                <span v-if="currentModel.sub" class="truncate text-gray-400">{{ currentModel.sub }}</span>
              </template>
              <span v-else class="text-gray-400">{{ t('settings.ai.semanticIndex.noModelSelected') }}</span>
            </div>
          </div>
          <UButton
            size="xs"
            :color="currentModel ? 'neutral' : 'primary'"
            :variant="currentModel ? 'soft' : 'solid'"
            class="shrink-0"
            @click="showModelModal = true"
          >
            {{ currentModel ? t('settings.ai.semanticIndex.switchModel') : t('settings.ai.semanticIndex.selectModel') }}
          </UButton>
        </div>
        <p v-if="!hasModelConfig" class="text-xs text-amber-500">{{ t('settings.ai.semanticIndex.configFirst') }}</p>
        <p
          v-if="modelStatus === 'downloading'"
          class="flex items-center gap-1.5 text-xs text-blue-500 dark:text-blue-400"
        >
          <UIcon name="i-heroicons-arrow-down-tray" class="h-3.5 w-3.5 animate-pulse shrink-0" />
          {{ t('settings.ai.semanticIndex.modelDownloading') }}
        </p>
        <p v-else-if="modelStatus === 'error'" class="text-xs text-red-500">
          {{ t('settings.ai.semanticIndex.modelError') }}
        </p>
      </div>

      <!-- 向量模型配置弹窗 -->
      <SemanticIndexModelModal
        v-model:open="showModelModal"
        :config="configured ? savedConfig : null"
        :api-key-set="apiKeySet"
        :saving="saving"
        @confirm="onModelConfirm"
      />

      <!-- 选定向量模型后才展示概览 / 已启用对话等 -->
      <template v-if="hasModelConfig">
        <!-- 索引概览 -->
        <div
          class="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50"
        >
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
            <span class="text-gray-500">
              {{ t('settings.ai.semanticIndex.coverage', { percent: overview.coverage }) }}
            </span>
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
        <SemanticIndexConversationPicker v-model="showPicker" :api-mode="isApiMode" @saved="loadStatuses" />

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
      </template>
    </template>
  </div>
</template>
