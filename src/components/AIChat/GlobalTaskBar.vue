<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useAIChatStore } from '@/stores/aiChat'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const aiChatStore = useAIChatStore()
const { activeTask } = storeToRefs(aiChatStore)
const activeTaskState = computed(() => aiChatStore.getActiveTaskState())

const shouldShowFloatingBar = computed(() => {
  if (!activeTask.value) return false

  const expectedRouteName = activeTask.value.chatType === 'group' ? 'group-chat' : 'private-chat'
  const isOnSameSessionAIPage =
    route.name === expectedRouteName &&
    String(route.params.id ?? '') === activeTask.value.sessionId &&
    route.query.tab === 'ai-chat'

  if (!isOnSameSessionAIPage) {
    return true
  }

  // 正在查看当前仍在推理的那条对话时，不再重复显示浮窗入口。
  const displayedConversationId = activeTaskState.value?.currentConversationId ?? null
  return displayedConversationId !== (activeTask.value.conversationId ?? null)
})

async function handleOpenTask() {
  if (!activeTask.value) return

  // 返回当前任务时，优先把正在流式写入的对话重新切回当前显示缓冲，
  // 避免用户此前查看了别的历史对话，回来后还停留在旧视图。
  aiChatStore.focusActiveTaskConversation()

  await router.push({
    name: activeTask.value.chatType === 'group' ? 'group-chat' : 'private-chat',
    params: { id: activeTask.value.sessionId },
    query: { tab: 'ai-chat' },
  })
}
</script>

<template>
  <Transition name="task-bar-fade">
    <div v-if="shouldShowFloatingBar" class="pointer-events-auto fixed right-4 bottom-[88px] z-40">
      <!-- 默认态直接作为返回入口，不再保留额外展开层。 -->
      <button
        class="group flex h-9 items-center gap-1.5 overflow-hidden rounded-full bg-primary-500 px-2 shadow-[0_10px_24px_rgba(15,23,42,0.12)] transition-all hover:-translate-y-0.5 hover:bg-primary-600 hover:shadow-[0_16px_32px_rgba(15,23,42,0.16)] dark:bg-primary-500 dark:hover:bg-primary-400"
        :title="`${t('ai.chat.backgroundTask.return')} · ${activeTask?.sessionName ?? ''}`"
        @click="handleOpenTask"
      >
        <div
          class="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-full bg-white text-primary-600 shadow-[0_2px_8px_rgba(255,255,255,0.28)]"
        >
          <UIcon name="i-heroicons-sparkles" class="h-3 w-3 animate-pulse" />
        </div>

        <span class="text-[11px] font-medium text-white">{{ t('ai.chat.backgroundTask.runningShort') }}</span>
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.task-bar-fade-enter-active,
.task-bar-fade-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.task-bar-fade-enter-from,
.task-bar-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
