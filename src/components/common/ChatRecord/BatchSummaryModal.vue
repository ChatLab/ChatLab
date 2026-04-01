<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDebounceFn } from '@vueuse/core'

const props = defineProps<{
  open: boolean
  sessionId: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  completed: []
}>()

const { t, locale } = useI18n()

// 计算属性：双向绑定 open
const isOpen = computed({
  get: () => props.open,
  set: (val) => emit('update:open', val),
})

// 查询模式：按时间 / 按范围
type QueryMode = 'time' | 'range'
const queryMode = ref<QueryMode>('range')

// 按范围选项（百分比 0-100）
const rangePercent = ref(50)
const totalSessionCount = ref(0) // 总会话数

// 时间范围选项
type TimeRangePreset = 'today' | 'yesterday' | 'week' | 'month' | 'custom'
const selectedPreset = ref<TimeRangePreset>('today')

// 自定义时间范围
const customStartDate = ref('')
const customEndDate = ref('')

// 会话列表
interface SessionItem {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  // 与 sessionApi 返回值保持一致，历史数据里 summary 可能不存在。
  summary?: string | null
}
const sessions = ref<SessionItem[]>([])
const isLoading = ref(false)

// 生成状态
const isGenerating = ref(false)
const currentIndex = ref(0)
const totalToGenerate = ref(0) // 记录开始时的总数
const results = ref<
  Array<{ id: number; status: 'success' | 'failed' | 'skipped'; message?: string; summary?: string }>
>([])
const shouldStop = ref(false)

// 判断是否是消息数量太少的错误
function isTooFewMessagesError(error: string): boolean {
  return error.includes('少于3条') || error.includes('less than 3') || error.includes('无需生成摘要')
}

// 滚动容器引用
const resultsContainer = ref<HTMLElement | null>(null)

// 计算时间范围
const timeRange = computed(() => {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (selectedPreset.value) {
    case 'today':
      return {
        start: today.getTime(),
        end: now.getTime(),
      }
    case 'yesterday': {
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      return {
        start: yesterday.getTime(),
        end: today.getTime() - 1,
      }
    }
    case 'week': {
      const weekAgo = new Date(today)
      weekAgo.setDate(weekAgo.getDate() - 7)
      return {
        start: weekAgo.getTime(),
        end: now.getTime(),
      }
    }
    case 'month': {
      const monthAgo = new Date(today)
      monthAgo.setMonth(monthAgo.getMonth() - 1)
      return {
        start: monthAgo.getTime(),
        end: now.getTime(),
      }
    }
    case 'custom':
      if (customStartDate.value && customEndDate.value) {
        const start = new Date(customStartDate.value)
        const end = new Date(customEndDate.value)
        return {
          start: start.getTime(),
          end: new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1).getTime(), // 当天结束
        }
      }
      return null
    default:
      return null
  }
})

// 会话可生成状态检查结果
const canGenerateMap = ref<Record<number, { canGenerate: boolean; reason?: string }>>({})
const isChecking = ref(false)

// 待生成的会话（排除已有摘要的 + 消息太少的）
const pendingSessions = computed(() => {
  return sessions.value.filter((s) => {
    if (s.summary) return false
    const checkResult = canGenerateMap.value[s.id]
    return checkResult?.canGenerate !== false
  })
})

// 已有摘要的会话数
const existingSummaryCount = computed(() => {
  return sessions.value.filter((s) => s.summary).length
})

// 消息数量太少的会话数（无摘要但无法生成）
const tooFewMessagesCount = computed(() => {
  return sessions.value.filter((s) => {
    if (s.summary) return false
    const checkResult = canGenerateMap.value[s.id]
    return checkResult?.canGenerate === false
  }).length
})

// 进度百分比
const progressPercent = computed(() => {
  if (totalToGenerate.value === 0) return 100
  return Math.round((currentIndex.value / totalToGenerate.value) * 100)
})

// 统计结果
const stats = computed(() => {
  const success = results.value.filter((r) => r.status === 'success').length
  const failed = results.value.filter((r) => r.status === 'failed').length
  const skipped = results.value.filter((r) => r.status === 'skipped').length
  return { success, failed, skipped }
})

// 查询会话
async function fetchSessions() {
  isLoading.value = true
  canGenerateMap.value = {}

  try {
    if (queryMode.value === 'range') {
      // 按范围查询：先获取总数，再按百分比计算数量
      const allSessions = await window.sessionApi.getSessions(props.sessionId)
      totalSessionCount.value = allSessions.length
      const count = Math.ceil(allSessions.length * (rangePercent.value / 100))
      // 取最近的 count 个会话（按时间倒序取后面的）
      sessions.value = allSessions.slice(-count)
    } else {
      // 按时间查询
      if (!timeRange.value) {
        sessions.value = []
        return
      }
      // 将时间戳转换为秒（数据库中使用秒）
      const startTs = Math.floor(timeRange.value.start / 1000)
      const endTs = Math.floor(timeRange.value.end / 1000)

      sessions.value = await window.sessionApi.getByTimeRange(props.sessionId, startTs, endTs)
    }

    // 检查哪些会话可以生成摘要
    if (sessions.value.length > 0) {
      await checkCanGenerate()
    }
  } catch (error) {
    console.error('查询会话失败:', error)
    sessions.value = []
  } finally {
    isLoading.value = false
  }
}

// 批量检查会话是否可以生成摘要
async function checkCanGenerate() {
  const noSummaryIds = sessions.value.filter((s) => !s.summary).map((s) => s.id)
  if (noSummaryIds.length === 0) return

  isChecking.value = true
  try {
    canGenerateMap.value = await window.sessionApi.checkCanGenerateSummary(props.sessionId, noSummaryIds)
  } catch (error) {
    console.error('检查会话摘要失败:', error)
  } finally {
    isChecking.value = false
  }
}

// 防抖版本的 fetchSessions（用于滑块拖动）
const debouncedFetchSessions = useDebounceFn(() => {
  fetchSessions()
}, 300)

// 监听查询条件变化
watch(
  () => [queryMode.value, selectedPreset.value, customStartDate.value, customEndDate.value],
  () => {
    if (queryMode.value === 'range') {
      fetchSessions()
    } else if (selectedPreset.value !== 'custom' || (customStartDate.value && customEndDate.value)) {
      fetchSessions()
    }
  },
  { immediate: true }
)

// 单独监听滑块值变化（使用防抖）
watch(
  () => rangePercent.value,
  () => {
    if (queryMode.value === 'range') {
      debouncedFetchSessions()
    }
  }
)

// 监听弹窗打开
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      // 重置状态
      isGenerating.value = false
      currentIndex.value = 0
      results.value = []
      shouldStop.value = false
      fetchSessions()
    }
  }
)

// 开始生成
async function startGenerate() {
  // 复制一份静态数组，避免在循环中因 computed 值变化导致问题
  const sessionsToProcess = [...pendingSessions.value]
  if (sessionsToProcess.length === 0) return

  isGenerating.value = true
  shouldStop.value = false
  currentIndex.value = 0
  totalToGenerate.value = sessionsToProcess.length
  results.value = []

  try {
    for (const session of sessionsToProcess) {
      if (shouldStop.value) break

      try {
        const result = await window.sessionApi.generateSummary(props.sessionId, session.id, locale.value, false)

        if (result.success) {
          // 成功：显示摘要内容
          results.value.push({
            id: session.id,
            status: 'success',
            summary: result.summary || '',
          })
          // 更新本地会话数据
          const idx = sessions.value.findIndex((s) => s.id === session.id)
          if (idx !== -1) {
            sessions.value[idx].summary = result.summary || ''
          }
        } else if (result.error && isTooFewMessagesError(result.error)) {
          // 消息数量太少：标记为跳过
          results.value.push({
            id: session.id,
            status: 'skipped',
            message: result.error,
          })
        } else {
          // 其他错误：标记为失败
          results.value.push({
            id: session.id,
            status: 'failed',
            message: result.error,
          })
        }
      } catch (error) {
        results.value.push({ id: session.id, status: 'failed', message: String(error) })
      }

      currentIndex.value++

      // 自动滚动到底部
      await nextTick()
      if (resultsContainer.value) {
        resultsContainer.value.scrollTop = resultsContainer.value.scrollHeight
      }
    }
  } finally {
    // 确保无论如何都结束生成状态
    isGenerating.value = false
  }

  // 如果有成功生成的，通知父组件刷新
  if (stats.value.success > 0) {
    emit('completed')
  }
}

// 停止生成
function stopGenerate() {
  shouldStop.value = true
}

// 关闭弹窗
function close() {
  if (isGenerating.value) {
    shouldStop.value = true
  }
  emit('update:open', false)
}
</script>

<template>
  <UModal v-model:open="isOpen" :ui="{ overlay: 'z-[10001]', content: 'z-[10001]' }">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold">{{ t('records.batchSummary.title', '批量生成摘要') }}</h3>
            <UButton color="neutral" variant="ghost" icon="i-heroicons-x-mark" size="sm" @click="close" />
          </div>
        </template>

        <div class="space-y-4">
          <!-- 查询模式切换 -->
          <div class="flex gap-2 border-b border-gray-200 dark:border-gray-700 pb-3">
            <UButton
              :color="queryMode === 'range' ? 'primary' : 'neutral'"
              :variant="queryMode === 'range' ? 'solid' : 'ghost'"
              size="sm"
              :disabled="isGenerating"
              @click="queryMode = 'range'"
            >
              {{ t('records.batchSummary.byRange', '按范围') }}
            </UButton>
            <UButton
              :color="queryMode === 'time' ? 'primary' : 'neutral'"
              :variant="queryMode === 'time' ? 'solid' : 'ghost'"
              size="sm"
              :disabled="isGenerating"
              @click="queryMode = 'time'"
            >
              {{ t('records.batchSummary.byTime', '按时间') }}
            </UButton>
          </div>

          <!-- 按范围选择 -->
          <div v-if="queryMode === 'range'">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {{ t('records.batchSummary.selectRange', '选择范围') }}
            </label>
            <div class="space-y-3">
              <div class="flex items-center gap-4">
                <USlider v-model="rangePercent" :min="1" :max="100" :step="1" :disabled="isGenerating" class="flex-1" />
                <span class="text-lg font-semibold text-primary-600 dark:text-primary-400 min-w-[4rem] text-right">
                  {{ rangePercent }}%
                </span>
              </div>
              <div class="text-xs text-gray-500 flex justify-between">
                <span>{{ t('records.batchSummary.rangeStart', '最早') }}</span>
                <span v-if="totalSessionCount > 0">
                  {{ t('records.batchSummary.rangeInfo', '约') }}
                  {{ Math.ceil((totalSessionCount * rangePercent) / 100) }} / {{ totalSessionCount }}
                  {{ t('records.batchSummary.sessionsUnit', '个会话') }}
                </span>
                <span>{{ t('records.batchSummary.rangeEnd', '最近') }}</span>
              </div>
            </div>
          </div>

          <!-- 按时间范围选择 -->
          <div v-else-if="queryMode === 'time'">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {{ t('records.batchSummary.timeRange', '选择时间范围') }}
            </label>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="preset in [
                  { key: 'today', label: t('records.batchSummary.today', '今天') },
                  { key: 'yesterday', label: t('records.batchSummary.yesterday', '昨天') },
                  { key: 'week', label: t('records.batchSummary.week', '最近7天') },
                  { key: 'month', label: t('records.batchSummary.month', '最近30天') },
                  { key: 'custom', label: t('records.batchSummary.custom', '自定义') },
                ]"
                :key="preset.key"
                :color="selectedPreset === preset.key ? 'primary' : 'neutral'"
                :variant="selectedPreset === preset.key ? 'solid' : 'outline'"
                size="sm"
                :disabled="isGenerating"
                @click="selectedPreset = preset.key as TimeRangePreset"
              >
                {{ preset.label }}
              </UButton>
            </div>

            <!-- 自定义日期选择 -->
            <div v-if="selectedPreset === 'custom'" class="mt-3 flex items-center gap-2">
              <UInput v-model="customStartDate" type="date" :disabled="isGenerating" size="sm" />
              <span class="text-gray-500">—</span>
              <UInput v-model="customEndDate" type="date" :disabled="isGenerating" size="sm" />
            </div>
          </div>

          <!-- 会话预览 -->
          <div v-if="!isLoading && !isChecking" class="text-sm text-gray-600 dark:text-gray-400">
            <template v-if="sessions.length > 0">
              <p>
                {{ t('records.batchSummary.found', '找到') }} {{ sessions.length }}
                {{ t('records.batchSummary.sessionsUnit', '个会话') }}
                <template v-if="existingSummaryCount > 0 || tooFewMessagesCount > 0">
                  <span class="text-gray-500">
                    （
                    <template v-if="existingSummaryCount > 0">
                      <span class="text-green-600 dark:text-green-400">
                        {{ existingSummaryCount }} {{ t('records.batchSummary.hasSummary', '个已有摘要') }}
                      </span>
                    </template>
                    <template v-if="existingSummaryCount > 0 && tooFewMessagesCount > 0">，</template>
                    <template v-if="tooFewMessagesCount > 0">
                      <span class="text-gray-400">
                        {{ tooFewMessagesCount }} {{ t('records.batchSummary.tooFewMessages', '个消息太少') }}
                      </span>
                    </template>
                    ）
                  </span>
                </template>
              </p>
              <p v-if="pendingSessions.length > 0" class="mt-1 font-medium">
                {{ t('records.batchSummary.pending', '待生成:') }} {{ pendingSessions.length }}
                {{ t('records.batchSummary.unit', '个') }}
              </p>
              <p v-else class="mt-1 text-gray-400">
                {{ t('records.batchSummary.noPending', '没有可生成的会话') }}
              </p>
            </template>
            <p v-else class="text-gray-400">
              {{ t('records.batchSummary.noSessions', '该时间范围内没有会话') }}
            </p>
          </div>
          <div v-else-if="isChecking" class="flex items-center gap-2 text-sm text-gray-500">
            <UIcon name="i-heroicons-arrow-path" class="animate-spin" />
            {{ t('records.batchSummary.checking', '检查中...') }}
          </div>
          <div v-else class="flex items-center gap-2 text-sm text-gray-500">
            <UIcon name="i-heroicons-arrow-path" class="animate-spin" />
            {{ t('records.batchSummary.loading', '加载中...') }}
          </div>

          <!-- 进度条 -->
          <div v-if="isGenerating || results.length > 0" class="space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span>{{ t('records.batchSummary.progress', '进度') }}</span>
              <span>{{ currentIndex }} / {{ totalToGenerate || pendingSessions.length }}</span>
            </div>
            <!-- 进行中：显示动画进度条 -->
            <UProgress v-if="isGenerating" :value="progressPercent" />
            <!-- 已完成：显示静态完成条 -->
            <div v-else class="h-2 w-full rounded-full bg-green-500" />
          </div>

          <!-- 结果列表 -->
          <div
            v-if="results.length > 0"
            ref="resultsContainer"
            class="max-h-64 overflow-y-auto rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50"
          >
            <div
              v-for="result in results"
              :key="result.id"
              class="flex flex-col gap-1 px-3 py-2 text-sm border-b border-gray-200 dark:border-gray-700 last:border-b-0"
            >
              <!-- 第一行：状态图标 + 会话ID + 状态文字 -->
              <div class="flex items-center gap-2">
                <UIcon
                  :name="
                    result.status === 'success'
                      ? 'i-heroicons-check-circle'
                      : result.status === 'skipped'
                        ? 'i-heroicons-minus-circle'
                        : 'i-heroicons-x-circle'
                  "
                  class="flex-shrink-0"
                  :class="{
                    'text-green-500': result.status === 'success',
                    'text-gray-400': result.status === 'skipped',
                    'text-red-500': result.status === 'failed',
                  }"
                />
                <span class="flex-1 font-medium">{{ t('records.batchSummary.session', '会话') }} #{{ result.id }}</span>
                <span
                  class="flex-shrink-0 text-xs"
                  :class="{
                    'text-green-600 dark:text-green-400': result.status === 'success',
                    'text-gray-500': result.status === 'skipped',
                    'text-red-600 dark:text-red-400': result.status === 'failed',
                  }"
                >
                  {{
                    result.status === 'success'
                      ? t('records.batchSummary.statusSuccess', '成功')
                      : result.status === 'skipped'
                        ? t('records.batchSummary.statusSkipped', '跳过')
                        : t('records.batchSummary.statusFailed', '失败')
                  }}
                </span>
              </div>
              <!-- 第二行：摘要内容或错误信息 -->
              <div v-if="result.summary" class="pl-6 text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                {{ result.summary }}
              </div>
              <div v-else-if="result.status === 'failed' && result.message" class="pl-6 text-xs text-red-500">
                {{ result.message }}
              </div>
              <div v-else-if="result.status === 'skipped'" class="pl-6 text-xs text-gray-400 italic">
                {{ t('records.batchSummary.tooFewMessages', '消息数量太少') }}
              </div>
            </div>
          </div>

          <!-- 统计结果 -->
          <div v-if="!isGenerating && results.length > 0" class="flex items-center gap-4 text-sm">
            <span class="text-green-600 dark:text-green-400">
              <UIcon name="i-heroicons-check-circle" class="mr-1" />
              {{ t('records.batchSummary.success', '成功:') }} {{ stats.success }}
            </span>
            <span v-if="stats.failed > 0" class="text-red-600 dark:text-red-400">
              <UIcon name="i-heroicons-x-circle" class="mr-1" />
              {{ t('records.batchSummary.failed', '失败:') }} {{ stats.failed }}
            </span>
            <span v-if="stats.skipped > 0" class="text-gray-500">
              <UIcon name="i-heroicons-minus-circle" class="mr-1" />
              {{ t('records.batchSummary.skipped', '跳过:') }} {{ stats.skipped }}
            </span>
          </div>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="outline" :disabled="isGenerating" @click="close">
              {{ t('common.close', '关闭') }}
            </UButton>
            <UButton
              v-if="!isGenerating"
              color="primary"
              :disabled="pendingSessions.length === 0 || isLoading"
              @click="startGenerate"
            >
              {{ t('records.batchSummary.start', '开始生成') }}
            </UButton>
            <UButton v-else color="error" @click="stopGenerate">
              {{ t('records.batchSummary.stop', '停止') }}
            </UButton>
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
