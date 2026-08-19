import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type { QAPair } from '../utils/chatMessages'

export const CHAT_HISTORY_BATCH_SIZE = 20

export function useProgressiveChatHistory(
  pairs: Ref<QAPair[]>,
  conversationId: Ref<string | null>,
  scrollContainer: Ref<HTMLElement | null>
) {
  const visibleCount = ref(CHAT_HISTORY_BATCH_SIZE)
  const visiblePairs = computed(() => pairs.value.slice(-visibleCount.value))
  const hasOlderPairs = computed(() => visibleCount.value < pairs.value.length)

  watch(
    [conversationId, () => pairs.value.length] as const,
    ([currentConversationId, length], [previousConversationId, previousLength]) => {
      if (currentConversationId !== previousConversationId) {
        visibleCount.value = CHAT_HISTORY_BATCH_SIZE
        return
      }
      if (length < previousLength) {
        visibleCount.value = Math.max(CHAT_HISTORY_BATCH_SIZE, Math.min(visibleCount.value, length))
      } else if (previousLength > 0 && visibleCount.value >= previousLength) {
        visibleCount.value = length
      }
    }
  )

  async function loadOlderPairs(): Promise<void> {
    if (!hasOlderPairs.value) return

    const container = scrollContainer.value
    const previousScrollHeight = container?.scrollHeight ?? 0
    const previousScrollTop = container?.scrollTop ?? 0
    visibleCount.value = Math.min(pairs.value.length, visibleCount.value + CHAT_HISTORY_BATCH_SIZE)
    await nextTick()

    if (container && scrollContainer.value === container) {
      container.scrollTop = previousScrollTop + (container.scrollHeight - previousScrollHeight)
    }
  }

  return {
    visiblePairs,
    hasOlderPairs,
    loadOlderPairs,
  }
}
