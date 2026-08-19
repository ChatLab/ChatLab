/**
 * 聊天消息区的智能滚动行为：
 * - 粘性底部（AI 流式输出时自动跟随）
 * - 用户主动上滚时解除粘性并显示"回到底部"
 * - 滚动到底部附近时重新粘住
 */

import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import type { Ref } from 'vue'
import type { ChatMessage } from '@/stores/aiChat'

const RESTICK_THRESHOLD = 30
const SCROLL_DELAY_MS = 100

export function createCoalescedScrollScheduler(
  callback: (force: boolean) => void,
  delayMs = SCROLL_DELAY_MS
): {
  schedule: (force?: boolean) => void
  cancel: () => void
} {
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  let pendingForce = false

  function schedule(force = false) {
    pendingForce ||= force
    if (pendingTimer !== null) return

    pendingTimer = setTimeout(() => {
      pendingTimer = null
      const forceCurrentRun = pendingForce
      pendingForce = false
      callback(forceCurrentRun)
    }, delayMs)
  }

  function cancel() {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
    pendingForce = false
  }

  return { schedule, cancel }
}

export function useChatScroll(messages: Ref<ChatMessage[]>, isAIThinking: Ref<boolean>) {
  const messagesContainer = ref<HTMLElement | null>(null)
  const isStickToBottom = ref(true)
  const showScrollToBottom = ref(false)

  const scrollScheduler = createCoalescedScrollScheduler((force) => {
    if (!messagesContainer.value) return
    if (force || isStickToBottom.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
      isStickToBottom.value = true
      showScrollToBottom.value = false
    }
  })

  function scrollToBottom(force = false) {
    scrollScheduler.schedule(force)
  }

  function handleWheel(event: WheelEvent) {
    if (event.deltaY < 0 && isAIThinking.value) {
      isStickToBottom.value = false
      showScrollToBottom.value = true
    }
  }

  function checkScrollPosition() {
    if (!messagesContainer.value) return
    const { scrollTop, scrollHeight, clientHeight } = messagesContainer.value
    if (scrollHeight - scrollTop - clientHeight < RESTICK_THRESHOLD) {
      isStickToBottom.value = true
      showScrollToBottom.value = false
    }
  }

  function handleScrollToBottom() {
    scrollToBottom(true)
  }

  // 合并三个触发源为单一 watcher：消息数量、最后一条内容、最后一条 contentBlocks 长度
  watch(
    () => {
      const last = messages.value[messages.value.length - 1]
      return [messages.value.length, last?.content, last?.contentBlocks?.length] as const
    },
    () => scrollToBottom()
  )

  onMounted(() => {
    if (messagesContainer.value) {
      messagesContainer.value.addEventListener('scroll', checkScrollPosition)
      messagesContainer.value.addEventListener('wheel', handleWheel, { passive: true })
    }
    if (messages.value.length > 0) {
      scrollToBottom(true)
    }
  })

  onBeforeUnmount(() => {
    scrollScheduler.cancel()
    if (messagesContainer.value) {
      messagesContainer.value.removeEventListener('scroll', checkScrollPosition)
      messagesContainer.value.removeEventListener('wheel', handleWheel)
    }
  })

  return {
    messagesContainer,
    showScrollToBottom,
    scrollToBottom,
    handleScrollToBottom,
  }
}
