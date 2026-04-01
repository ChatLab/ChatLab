<script setup lang="ts">
/**
 * 聊天记录查看器 Drawer
 * 主组件，组合筛选面板、消息列表、会话时间线等子组件
 */
import { ref, watch, toRaw, nextTick, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import FilterPanel from './FilterPanel.vue'
import MessageList from './MessageList.vue'
import SessionTimeline from './SessionTimeline.vue'
import type { ChatRecordQuery } from './types'
import { useLayoutStore } from '@/stores/layout'
import { useSessionStore } from '@/stores/session'
import { storeToRefs } from 'pinia'

const { t } = useI18n()
const layoutStore = useLayoutStore()
const sessionStore = useSessionStore()
const { currentSessionId } = storeToRefs(sessionStore)

// 平台检测
const isWindows = ref(false)

onMounted(() => {
  isWindows.value = navigator.platform.toLowerCase().includes('win')
})

// 消息列表组件引用
const messageListRef = ref<InstanceType<typeof MessageList> | null>(null)

// 本地查询条件（可编辑的副本）
const localQuery = ref<ChatRecordQuery>({})

// 消息数量
const messageCount = ref(0)

// 时间线折叠状态
const timelineCollapsed = ref(false)

// 当前激活的会话 ID（用于联动高亮）
const activeSessionId = ref<number | undefined>(undefined)

// 会话列表缓存（用于根据消息 ID 查找所属会话）
const sessionsCache = ref<Array<{ id: number; startTs: number; endTs: number; firstMessageId: number }>>([])

// 匹配消息所属的会话 ID 集合（用于关键词筛选时联动时间线）
const matchedSessionIds = ref<Set<number> | undefined>(undefined)

// 应用筛选
function handleApplyFilter(query: ChatRecordQuery) {
  localQuery.value = query
}

// 重置筛选
function handleResetFilter() {
  localQuery.value = {}
  matchedSessionIds.value = undefined
}

// 处理消息数量变化
function handleCountChange(count: number) {
  messageCount.value = count
}

// 处理消息时间戳变化（用于计算匹配的会话 ID）
function handleMessageTimestampsChange(timestamps: number[]) {
  // 只有在关键词筛选时才计算匹配的会话
  if (!localQuery.value.keywords?.length || !sessionsCache.value.length) {
    matchedSessionIds.value = undefined
    return
  }

  // 根据消息时间戳找出对应的会话 ID
  const sessionIds = new Set<number>()
  for (const ts of timestamps) {
    for (const session of sessionsCache.value) {
      if (ts >= session.startTs && ts <= session.endTs) {
        sessionIds.add(session.id)
        break
      }
    }
  }

  matchedSessionIds.value = sessionIds.size > 0 ? sessionIds : undefined
}

// 处理当前可见消息变化（用于联动高亮时间线）
function handleVisibleMessageChange(payload: { id: number; timestamp: number }) {
  if (!sessionsCache.value.length) return

  // 优先按时间范围匹配所属会话，避免增量导入后 messageId 与时间顺序不一致导致联动错误。
  let targetSession: { id: number } | undefined
  for (const session of sessionsCache.value) {
    if (payload.timestamp >= session.startTs && payload.timestamp <= session.endTs) {
      targetSession = session
      break
    }
  }

  // 兜底：若时间匹配失败，再退回旧的 messageId 规则，保证历史行为可用。
  if (!targetSession) {
    for (const session of sessionsCache.value) {
      if (session.firstMessageId <= payload.id) {
        targetSession = session
      } else {
        break
      }
    }
  }

  if (targetSession && targetSession.id !== activeSessionId.value) {
    activeSessionId.value = targetSession.id
  }
}

// 处理时间线会话选择
function handleSessionSelect(_sessionId: number, firstMessageId: number) {
  activeSessionId.value = _sessionId

  // 检查目标消息是否在当前已加载的消息范围内
  // 如果不在，则通过设置 scrollToMessageId 触发重新加载
  // 这样 MessageList 会以目标消息为中心加载前后各 50 条
  localQuery.value = {
    ...localQuery.value,
    scrollToMessageId: firstMessageId,
  }
}

// 处理跳转到消息（查看上下文）
function handleJumpToMessage(messageId: number) {
  // 清空筛选条件，只保留 scrollToMessageId
  localQuery.value = {
    scrollToMessageId: messageId,
  }
}

// 加载会话列表缓存
async function loadSessionsCache() {
  if (!currentSessionId.value) return

  try {
    const sessions = await window.sessionApi.getSessions(currentSessionId.value)
    sessionsCache.value = sessions.map((s) => ({
      id: s.id,
      startTs: s.startTs,
      endTs: s.endTs,
      firstMessageId: s.firstMessageId,
    }))
  } catch {
    sessionsCache.value = []
  }
}

// 监听 Drawer 打开
watch(
  () => layoutStore.showChatRecordDrawer,
  async (isOpen) => {
    if (isOpen) {
      // 复制查询参数到本地
      const query = toRaw(layoutStore.chatRecordQuery)
      localQuery.value = query ? { ...query } : {}
      // 加载会话缓存
      await loadSessionsCache()
      // 设置初始激活会话为最后一个（最新的）
      if (sessionsCache.value.length > 0) {
        activeSessionId.value = sessionsCache.value[sessionsCache.value.length - 1].id
      }
      // 等待 DOM 更新后主动触发加载
      await nextTick()
      messageListRef.value?.refresh()
    } else {
      // 关闭时清理
      localQuery.value = {}
      messageCount.value = 0
      activeSessionId.value = undefined
      sessionsCache.value = []
    }
  }
)
</script>

<template>
  <UDrawer v-model:open="layoutStore.showChatRecordDrawer" direction="right" :handle="false" :ui="{ content: 'z-50' }">
    <template #content>
      <div class="flex h-full w-[680px] flex-col bg-white dark:bg-gray-900" style="-webkit-app-region: no-drag">
        <!-- 头部 -->
        <div
          class="flex items-center justify-between border-b border-gray-200 px-4 dark:border-gray-800"
          :class="isWindows ? 'pt-10 pb-3' : 'py-3'"
        >
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('records.drawer.title') }}</h3>
          <UButton
            icon="i-heroicons-x-mark"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="layoutStore.closeChatRecordDrawer()"
          />
        </div>

        <!-- 筛选面板 -->
        <FilterPanel :query="localQuery" @apply="handleApplyFilter" @reset="handleResetFilter" />

        <!-- 主内容区：时间线 + 消息列表 -->
        <div class="flex min-h-0 flex-1">
          <!-- 会话时间线 -->
          <SessionTimeline
            v-if="currentSessionId"
            v-model:collapsed="timelineCollapsed"
            :session-id="currentSessionId"
            :active-session-id="activeSessionId"
            :filter-start-ts="localQuery.startTs"
            :filter-end-ts="localQuery.endTs"
            :filter-matched-session-ids="matchedSessionIds"
            @select="handleSessionSelect"
          />

          <!-- 消息列表容器 -->
          <div class="min-h-0 min-w-0 flex-1">
            <MessageList
              ref="messageListRef"
              :query="localQuery"
              @count-change="handleCountChange"
              @visible-message-change="handleVisibleMessageChange"
              @jump-to-message="handleJumpToMessage"
              @message-timestamps-change="handleMessageTimestampsChange"
            />
          </div>
        </div>

        <!-- 底部统计 -->
        <div v-if="messageCount > 0" class="shrink-0 border-t border-gray-200 px-4 py-2 dark:border-gray-800">
          <span class="text-xs text-gray-500">{{ t('records.drawer.loadedCount', { count: messageCount }) }}</span>
        </div>
      </div>
    </template>
  </UDrawer>
</template>
