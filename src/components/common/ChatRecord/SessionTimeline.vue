<script setup lang="ts">
/**
 * 会话时间线组件
 * 使用 @tanstack/vue-virtual 实现虚拟滚动
 */
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useSessionIndexService, type ChatSessionItem } from '@/services'
import { getSummaryStrategy } from '@/composables/useUiConfig'
import BatchSummaryModal from './BatchSummaryModal.vue'
import { buildGenerateSummaryArgs } from './summaryGeneration'

// 扁平化列表项类型
type FlatListItem =
  | { type: 'date'; date: string; label: string; count: number }
  | { type: 'session'; session: ChatSessionItem }

const props = defineProps<{
  sessionId: string
  /** 当前激活的会话 ID（用于高亮） */
  activeSessionId?: number
  /** 是否折叠整个面板 */
  collapsed?: boolean
  /** 筛选条件：起始时间戳 */
  filterStartTs?: number
  /** 筛选条件：结束时间戳 */
  filterEndTs?: number
  /** 筛选条件：匹配的会话 ID 集合（关键词筛选时使用） */
  filterMatchedSessionIds?: Set<number>
}>()

const emit = defineEmits<{
  /** 选择会话 */
  (e: 'select', sessionId: number, firstMessageId: number): void
  /** 折叠状态变化 */
  (e: 'update:collapsed', value: boolean): void
}>()

const { t, locale } = useI18n()
const toast = useToast()

// 状态
const allSessions = ref<ChatSessionItem[]>([])
const isLoading = ref(true)
const scrollContainerRef = ref<HTMLElement | null>(null)

// 正在生成摘要的会话 ID 集合
const generatingSummaryIds = ref<Set<number>>(new Set())

// 批量生成弹窗状态
const showBatchSummaryModal = ref(false)

// 是否折叠
const isCollapsed = computed({
  get: () => props.collapsed ?? false,
  set: (v) => emit('update:collapsed', v),
})

// 根据筛选条件过滤的会话列表
const filteredSessions = computed(() => {
  let sessions = allSessions.value
  if (sessions.length === 0) return []

  // 优先使用匹配的会话 ID 集合筛选（关键词筛选时）
  if (props.filterMatchedSessionIds && props.filterMatchedSessionIds.size > 0) {
    sessions = sessions.filter((session) => props.filterMatchedSessionIds!.has(session.id))
  }
  // 其次根据时间范围筛选
  else if (props.filterStartTs || props.filterEndTs) {
    sessions = sessions.filter((session) => {
      // 会话与筛选时间范围有交集即显示
      const sessionStart = session.startTs
      const sessionEnd = session.endTs

      if (props.filterStartTs && sessionEnd < props.filterStartTs) return false
      if (props.filterEndTs && sessionStart > props.filterEndTs) return false

      return true
    })
  }

  return sessions
})

// 将会话列表转换为扁平化列表（日期头 + 会话项）
const flatList = computed<FlatListItem[]>(() => {
  const sessions = filteredSessions.value
  if (sessions.length === 0) return []

  const result: FlatListItem[] = []
  const dateGroups = new Map<string, { label: string; sessions: ChatSessionItem[] }>()

  // 按日期分组
  for (const session of sessions) {
    const dateKey = getDateKey(session.startTs)
    let group = dateGroups.get(dateKey)
    if (!group) {
      group = {
        label: formatDate(session.startTs),
        sessions: [],
      }
      dateGroups.set(dateKey, group)
    }
    group.sessions.push(session)
  }

  // 按日期升序排列
  const sortedDates = Array.from(dateGroups.entries()).sort((a, b) => a[0].localeCompare(b[0]))

  // 扁平化：日期头 + 会话项
  for (const [dateKey, group] of sortedDates) {
    // 日期头
    result.push({
      type: 'date',
      date: dateKey,
      label: group.label,
      count: group.sessions.length,
    })

    // 该日期下的会话（按时间升序）
    const sortedSessions = group.sessions.sort((a, b) => a.startTs - b.startTs)
    for (const session of sortedSessions) {
      result.push({ type: 'session', session })
    }
  }

  return result
})

// 根据会话 ID 哈希映射莫兰迪低饱和度配色
function getSessionAvatarClass(sessionId: number): string {
  const colors = [
    // 粉色
    'bg-pink-50 dark:bg-pink-950/30 text-pink-500 dark:text-pink-400',
    // 蓝色
    'bg-blue-50 dark:bg-blue-950/30 text-blue-500 dark:text-blue-400',
    // 绿色
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-500 dark:text-emerald-400',
    // 紫色
    'bg-violet-50 dark:bg-violet-950/30 text-violet-500 dark:text-violet-400',
    // 黄色
    'bg-amber-50 dark:bg-amber-950/30 text-amber-500 dark:text-amber-400',
  ]
  return colors[sessionId % colors.length]
}

// 估算项目高度
const ESTIMATED_DATE_HEIGHT = 28 // 日期头高度
const ESTIMATED_SESSION_HEIGHT = 52 // 会话项高度（摘要/生成按钮单独一行）

// 虚拟化器
const virtualizer = useVirtualizer(
  computed(() => ({
    count: flatList.value.length,
    getScrollElement: () => scrollContainerRef.value,
    estimateSize: (index: number) => {
      const item = flatList.value[index]
      return item?.type === 'date' ? ESTIMATED_DATE_HEIGHT : ESTIMATED_SESSION_HEIGHT
    },
    overscan: 10,
    getItemKey: (index: number) => {
      const item = flatList.value[index]
      if (!item) return index
      if (item.type === 'date') return `date-${item.date}`
      return `session-${item.session.id}`
    },
  }))
)

// 虚拟化后的项目
const virtualItems = computed(() => virtualizer.value.getVirtualItems())

// 总高度
const totalSize = computed(() => virtualizer.value.getTotalSize())

// 格式化日期
function formatDate(ts: number): string {
  const date = new Date(ts * 1000)
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

// 格式化时间
function formatTime(ts: number): string {
  const date = new Date(ts * 1000)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// 获取日期键
function getDateKey(ts: number): string {
  const date = new Date(ts * 1000)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// 加载会话列表
async function loadSessions() {
  if (!props.sessionId) return

  isLoading.value = true
  try {
    const data = await useSessionIndexService().getSessions(props.sessionId)
    allSessions.value = data
  } catch (error) {
    console.error('加载会话列表失败:', error)
  } finally {
    isLoading.value = false
  }

  // 滚动需等 isLoading 置 false 后虚拟容器（v-else）渲染完成，否则 getScrollElement 为 null。
  // 默认滚到当前激活会话（即最新会话），与右侧消息列表展示最新内容保持一致。
  await nextTick()
  setTimeout(() => {
    if (props.activeSessionId) {
      scrollToSession(props.activeSessionId)
    } else {
      scrollToBottom()
    }
  }, 50)
}

// 滚动到底部
function scrollToBottom() {
  if (flatList.value.length > 0) {
    virtualizer.value.scrollToIndex(flatList.value.length - 1, { align: 'end' })
  }
}

// 滚动到指定会话
function scrollToSession(sessionId: number, behavior: 'auto' | 'smooth' = 'auto') {
  const index = flatList.value.findIndex((item) => item.type === 'session' && item.session.id === sessionId)
  if (index !== -1) {
    virtualizer.value.scrollToIndex(index, { align: 'center', behavior })
  }
}

// 选择会话
function handleSelectSession(session: ChatSessionItem) {
  emit('select', session.id, session.firstMessageId)
}

// 生成摘要
async function generateSummary(session: ChatSessionItem, event: Event) {
  event.stopPropagation() // 防止触发选择会话
  event.preventDefault()

  console.log('[SessionTimeline] 开始生成摘要:', session.id, props.sessionId)

  if (generatingSummaryIds.value.has(session.id)) {
    console.log('[SessionTimeline] 已在生成中，跳过')
    return
  }

  generatingSummaryIds.value.add(session.id)
  console.log('[SessionTimeline] 正在生成中的会话:', Array.from(generatingSummaryIds.value))

  try {
    console.log('[SessionTimeline] 调用 IPC...')
    const result = await useSessionIndexService().generateSummary(
      ...buildGenerateSummaryArgs(props.sessionId, session.id, locale.value, getSummaryStrategy())
    )
    console.log('[SessionTimeline] IPC 返回:', result)

    if (result.success && result.summary) {
      const index = allSessions.value.findIndex((s) => s.id === session.id)
      if (index !== -1) {
        allSessions.value[index] = { ...allSessions.value[index], summary: result.summary }
      }
    } else {
      toast.fail(t('records.summaryFailed', '摘要生成失败'), {
        description: result.error || t('records.summaryUnknownError', '未知错误'),
      })
    }
  } catch (error) {
    toast.fail(t('records.summaryFailed', '摘要生成失败'), { description: String(error) })
  } finally {
    generatingSummaryIds.value.delete(session.id)
    console.log('[SessionTimeline] 生成完成')
  }
}

// 判断是否正在生成摘要
function isGenerating(sessionId: number): boolean {
  return generatingSummaryIds.value.has(sessionId)
}

// 测量元素高度
function measureElement(el: Element | null) {
  if (el) {
    virtualizer.value.measureElement(el)
  }
}

// 当 activeSessionId 变化时，滚动到对应会话
watch(
  () => props.activeSessionId,
  (newId) => {
    if (newId) {
      scrollToSession(newId, 'smooth')
    }
  }
)

// 监听 sessionId 变化，重新加载
watch(
  () => props.sessionId,
  () => {
    loadSessions()
  },
  { immediate: true }
)
</script>

<template>
  <!-- 折叠状态 -->
  <div
    v-if="isCollapsed"
    class="flex h-full w-10 flex-col items-center border-r border-gray-200 bg-gray-50 py-2 dark:border-gray-700 dark:bg-page-dark/50"
  >
    <UButton icon="i-heroicons-chevron-right" variant="ghost" size="xs" @click="isCollapsed = false" />
    <div class="mt-2 flex flex-1 items-center">
      <span class="vertical-text text-xs text-gray-400">{{ t('records.timeline.timeline') }}</span>
    </div>
  </div>

  <!-- 展开状态 -->
  <div
    v-else
    class="flex h-full w-56 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-page-dark/50"
  >
    <!-- 头部 -->
    <div class="flex items-center justify-between border-b border-gray-200 px-2 py-1.5 dark:border-gray-700">
      <span class="text-xs font-medium text-gray-600 dark:text-gray-300">{{ t('records.timeline.timeline') }}</span>
      <div class="flex items-center gap-0.5">
        <UTooltip :text="t('records.batchSummary.title')">
          <UButton icon="i-heroicons-sparkles" variant="ghost" size="xs" @click="showBatchSummaryModal = true">
            {{ t('records.batchSummary.trigger') }}
          </UButton>
        </UTooltip>
        <UButton icon="i-heroicons-chevron-left" variant="ghost" size="xs" @click="isCollapsed = true" />
      </div>
    </div>

    <!-- 加载中 -->
    <div v-if="isLoading" class="flex flex-1 items-center justify-center">
      <UIcon name="i-heroicons-arrow-path" class="h-4 w-4 animate-spin text-gray-400" />
    </div>

    <!-- 空状态 -->
    <div v-else-if="allSessions.length === 0" class="flex flex-1 items-center justify-center p-2">
      <span class="text-xs text-gray-400">{{ t('records.timeline.noSessions') }}</span>
    </div>

    <!-- 虚拟滚动会话列表 -->
    <div v-else ref="scrollContainerRef" class="flex-1 overflow-y-auto py-1">
      <div class="relative w-full" :style="{ height: `${totalSize}px` }">
        <div
          v-for="virtualItem in virtualItems"
          :key="String(virtualItem.key)"
          :ref="(el) => measureElement(el as Element)"
          class="absolute left-0 top-0 w-full"
          :style="{ transform: `translateY(${virtualItem.start}px)` }"
        >
          <!-- 日期头 -->
          <template v-if="flatList[virtualItem.index]?.type === 'date'">
            <div class="flex w-full items-center gap-1 px-2 py-1">
              <span class="text-xs font-medium text-gray-700 dark:text-gray-200">
                {{ (flatList[virtualItem.index] as { label: string }).label }}
              </span>
              <span class="text-xs text-gray-400">
                ({{ (flatList[virtualItem.index] as { count: number }).count }})
              </span>
            </div>
          </template>

          <!-- 会话项 -->
          <template v-else-if="flatList[virtualItem.index]?.type === 'session'">
            <div class="px-1.5 py-0.5">
              <button
                class="group relative flex h-12 w-full items-center gap-2.5 rounded-xl p-1.5 pl-2.5 text-left transition-all duration-200"
                :class="[
                  activeSessionId === (flatList[virtualItem.index] as { session: ChatSessionItem }).session.id
                    ? 'bg-pink-500/5 dark:bg-pink-500/10'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800/60',
                ]"
                @click="handleSelectSession((flatList[virtualItem.index] as { session: ChatSessionItem }).session)"
              >
                <!-- 动态微型激活指示器 -->
                <div
                  class="absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-md transition-all duration-200"
                  :class="[
                    activeSessionId === (flatList[virtualItem.index] as { session: ChatSessionItem }).session.id
                      ? 'h-5 bg-pink-500 dark:bg-pink-400 opacity-100'
                      : 'h-0 bg-pink-500/40 dark:bg-pink-400/40 group-hover:h-3 group-hover:opacity-100 opacity-0',
                  ]"
                />

                <!-- 莫兰迪配色哈希头像 -->
                <div
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg px-1 font-mono text-[10px] font-semibold transition-colors"
                  :class="
                    getSessionAvatarClass((flatList[virtualItem.index] as { session: ChatSessionItem }).session.id)
                  "
                >
                  <span class="truncate">
                    {{ (flatList[virtualItem.index] as { session: ChatSessionItem }).session.messageCount }}
                  </span>
                </div>

                <div class="min-w-0 flex-1">
                  <div class="min-w-0">
                    <!-- 有摘要：时间和摘要作为连续文本排版，换行后从整行起点继续显示 -->
                    <UTooltip
                      v-if="(flatList[virtualItem.index] as { session: ChatSessionItem }).session.summary"
                      :content="{ side: 'right', align: 'start' }"
                      :ui="{ content: 'z-[10001] h-auto max-h-80 overflow-y-auto' }"
                    >
                      <span
                        class="line-clamp-2 min-w-0 text-xs font-normal leading-snug text-gray-500 dark:text-gray-400"
                      >
                        <span class="font-medium">
                          {{
                            formatTime((flatList[virtualItem.index] as { session: ChatSessionItem }).session.startTs)
                          }}
                        </span>
                        <span class="ml-1">
                          {{ (flatList[virtualItem.index] as { session: ChatSessionItem }).session.summary }}
                        </span>
                      </span>
                      <template #content>
                        <div class="max-w-sm whitespace-pre-wrap text-sm leading-relaxed font-normal">
                          {{ (flatList[virtualItem.index] as { session: ChatSessionItem }).session.summary }}
                        </div>
                      </template>
                    </UTooltip>
                    <span v-else class="text-xs font-medium text-gray-500 dark:text-gray-400">
                      {{ formatTime((flatList[virtualItem.index] as { session: ChatSessionItem }).session.startTs) }}
                    </span>
                  </div>

                  <div
                    v-if="!(flatList[virtualItem.index] as { session: ChatSessionItem }).session.summary"
                    class="mt-0.5 flex min-w-0 items-center"
                  >
                    <!-- 无摘要且消息数>=3：显示生成按钮 -->
                    <span
                      v-if="(flatList[virtualItem.index] as { session: ChatSessionItem }).session.messageCount >= 3"
                      class="flex min-w-0 cursor-pointer items-center gap-1 text-xs text-gray-400 hover:text-pink-500 dark:text-gray-500 dark:hover:text-pink-400"
                      @click="
                        generateSummary((flatList[virtualItem.index] as { session: ChatSessionItem }).session, $event)
                      "
                    >
                      <UIcon
                        v-if="isGenerating((flatList[virtualItem.index] as { session: ChatSessionItem }).session.id)"
                        name="i-heroicons-arrow-path"
                        class="h-3 w-3 shrink-0 animate-spin"
                      />
                      <UIcon v-else name="i-heroicons-sparkles" class="h-3 w-3 shrink-0" />
                      <span class="truncate">{{ t('records.timeline.generateSummary') }}</span>
                    </span>

                    <!-- 消息数<3：显示提示 -->
                    <span v-else class="min-w-0 flex-1 truncate text-xs italic text-gray-300 dark:text-gray-600">
                      {{ t('records.timeline.tooFewMessages') }}
                    </span>
                  </div>
                </div>
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>

  <!-- 批量生成摘要弹窗 -->
  <BatchSummaryModal v-model:open="showBatchSummaryModal" :session-id="sessionId" @completed="loadSessions" />
</template>

<style scoped>
.vertical-text {
  writing-mode: vertical-rl;
  text-orientation: mixed;
}
</style>
