<script setup lang="ts">
/**
 * 当前对话语义索引弹窗
 *
 * 只管理当前群聊/私聊：启用/停用、建立/暂停/继续/取消/重建，及状态展示。
 * 不在此配置向量模型/API（那是 设置 > AI > 语义索引 的职责）。
 */
import { ref, computed, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSemanticIndexService } from '@/services'
import type { SemanticIndexSessionStatus } from '@/services'

const props = defineProps<{
  modelValue: boolean
  sessionId: string
  messageCount?: number
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const { t } = useI18n()
const service = useSemanticIndexService()

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const status = ref<SemanticIndexSessionStatus | null>(null)
const hasModelConfig = ref(false)
const loading = ref(false)
const busy = ref(false)

const k = 'settings.ai.semanticIndex'

const stateLabel = computed(() => {
  const s = status.value
  if (!s || !s.enabled) return t(`${k}.session.notEnabled`)
  if (s.needsRebuild) return t(`${k}.state.needsRebuild`)
  if (s.running || s.queued || s.indexStatus === 'running') return t(`${k}.state.building`)
  if (s.indexStatus === 'completed') return t(`${k}.state.completed`)
  if (s.indexStatus === 'failed') return t(`${k}.state.failed`)
  if (s.indexStatus === 'paused') return t(`${k}.state.paused`)
  return t(`${k}.state.pending`)
})

const isRunning = computed(() => {
  const s = status.value
  return !!s && (s.running || s.queued || s.indexStatus === 'running')
})

const coveragePercent = computed(() =>
  status.value && status.value.totalMessages > 0
    ? Math.round((status.value.indexedMessages / status.value.totalMessages) * 100)
    : 0
)

// 运行中静默轮询，让用户实时看到建立进度
let pollTimer: ReturnType<typeof setTimeout> | null = null
function clearPoll() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}
function schedulePoll() {
  clearPoll()
  pollTimer = setTimeout(async () => {
    try {
      status.value = await service.status(props.sessionId)
    } catch (error) {
      console.error('[semantic-index] poll status failed:', error)
    }
    if (isRunning.value && props.modelValue) schedulePoll()
    else clearPoll()
  }, 1500)
}

async function load() {
  loading.value = true
  try {
    const [cfg, st] = await Promise.all([service.getConfig(), service.status(props.sessionId)])
    hasModelConfig.value =
      cfg.config.mode === 'local'
        ? !!cfg.config.local.modelId
        : !!cfg.config.api?.baseUrl && !!cfg.config.api?.model && cfg.apiKeySet
    status.value = st
  } catch (error) {
    console.error('[semantic-index] load session status failed:', error)
  } finally {
    loading.value = false
  }
  if (isRunning.value) schedulePoll()
}

async function act(action: 'enable' | 'disable' | 'build' | 'pause' | 'cancel' | 'rebuild') {
  busy.value = true
  try {
    status.value = await service[action](props.sessionId)
  } catch (error) {
    console.error(`[semantic-index] ${action} failed:`, error)
  } finally {
    busy.value = false
  }
  if (isRunning.value) schedulePoll()
  else clearPoll()
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) load()
    else clearPoll()
  }
)

onUnmounted(clearPoll)
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'z-[101]', overlay: 'z-[100]' }">
    <template #content>
      <div class="space-y-4 p-5">
        <div class="flex items-center gap-2">
          <UIcon name="i-heroicons-circle-stack" class="h-5 w-5 text-blue-500" />
          <h3 class="text-base font-semibold text-gray-900 dark:text-white">{{ t(`${k}.title`) }}</h3>
        </div>

        <div v-if="loading" class="flex items-center gap-2 text-sm text-gray-400">
          <UIcon name="i-heroicons-arrow-path" class="h-4 w-4 animate-spin" />
          {{ t('common.loading') }}
        </div>

        <template v-else>
          <!-- 状态 -->
          <div
            class="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-800/50"
          >
            <div class="flex items-center justify-between">
              <span class="text-gray-500">{{ t(`${k}.session.statusLabel`) }}</span>
              <span class="font-medium text-gray-800 dark:text-gray-200">{{ stateLabel }}</span>
            </div>
            <div
              v-if="status?.enabled && status.indexStatus === 'completed'"
              class="mt-1 flex items-center justify-between"
            >
              <span class="text-gray-500">{{ t(`${k}.session.coverageLabel`) }}</span>
              <span class="text-gray-700 dark:text-gray-300">{{ coveragePercent }}%</span>
            </div>
            <div v-if="isRunning" class="mt-2">
              <div class="flex items-center justify-between text-xs text-gray-500">
                <span>{{ t(`${k}.session.progressLabel`) }}</span>
                <span>
                  {{ status?.indexedMessages ?? 0 }} / {{ status?.totalMessages ?? 0 }} ({{ coveragePercent }}%)
                </span>
              </div>
              <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  class="h-full rounded-full bg-blue-500 transition-all duration-500"
                  :style="{ width: `${coveragePercent}%` }"
                />
              </div>
            </div>
            <p v-if="status?.error" class="mt-1 text-xs text-red-500">{{ status.error }}</p>
          </div>

          <!-- 未启用 -->
          <template v-if="!status?.enabled">
            <p class="text-sm text-gray-600 dark:text-gray-400">{{ t(`${k}.session.enableHint`) }}</p>
            <p
              v-if="!hasModelConfig"
              class="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-400"
            >
              {{ t(`${k}.session.configFirst`) }}
            </p>
            <div class="flex justify-end gap-2">
              <UButton variant="ghost" @click="open = false">{{ t('common.close') }}</UButton>
              <UButton color="primary" :loading="busy" :disabled="!hasModelConfig" @click="act('enable')">
                {{ t(`${k}.session.enable`) }}
              </UButton>
            </div>
          </template>

          <!-- 已启用 -->
          <template v-else>
            <p class="text-xs text-gray-400">{{ t(`${k}.session.buildVsEnable`) }}</p>
            <div class="flex flex-wrap justify-end gap-2">
              <template v-if="isRunning">
                <UButton variant="soft" :loading="busy" @click="act('pause')">{{ t(`${k}.action.pause`) }}</UButton>
                <UButton color="error" variant="soft" :disabled="busy" @click="act('cancel')">
                  {{ t(`${k}.action.cancel`) }}
                </UButton>
              </template>
              <template v-else-if="status?.indexStatus === 'completed' && !status?.needsRebuild">
                <UButton variant="soft" :loading="busy" @click="act('rebuild')">{{ t(`${k}.action.rebuild`) }}</UButton>
              </template>
              <template v-else-if="status?.needsRebuild">
                <UButton color="primary" :loading="busy" @click="act('rebuild')">
                  {{ t(`${k}.action.rebuild`) }}
                </UButton>
              </template>
              <template v-else-if="status?.indexStatus === 'failed'">
                <UButton color="primary" :loading="busy" @click="act('build')">{{ t(`${k}.session.retry`) }}</UButton>
              </template>
              <template v-else-if="status?.indexStatus === 'paused'">
                <UButton color="primary" :loading="busy" @click="act('build')">
                  {{ t(`${k}.session.continue`) }}
                </UButton>
              </template>
              <template v-else>
                <UButton color="primary" :loading="busy" @click="act('build')">{{ t(`${k}.action.build`) }}</UButton>
              </template>
              <UButton variant="ghost" color="neutral" :disabled="busy" @click="act('disable')">
                {{ t(`${k}.action.disable`) }}
              </UButton>
            </div>
          </template>
        </template>
      </div>
    </template>
  </UModal>
</template>
