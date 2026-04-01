<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { SubTabs } from '@/components/UI'
import { ChatExplorer } from '../AIChat'
import SQLLabTab from './SQLLabTab.vue'

const { t } = useI18n()
const route = useRoute()

// Props
const props = defineProps<{
  sessionId: string
  sessionName: string
  timeFilter?: { startTs: number; endTs: number }
  chatType?: 'group' | 'private'
  mode?: 'full' | 'sql-only'
}>()

const subTabs = computed(() => {
  // 实验室模式下只保留 SQL 实验室子 Tab，一级导航由外层页面承载。
  if (props.mode === 'sql-only') {
    return [{ id: 'sql-lab', label: t('ai.tab.sqlLab'), icon: 'i-heroicons-command-line' }]
  }

  return [
    { id: 'chat-explorer', label: t('ai.tab.chatExplorer'), icon: 'i-heroicons-chat-bubble-left-ellipsis' },
    { id: 'sql-lab', label: t('ai.tab.sqlLab'), icon: 'i-heroicons-command-line' },
  ]
})

const activeSubTab = ref(props.mode === 'sql-only' ? 'sql-lab' : (route.query.aiSubTab as string) || 'chat-explorer')

// 悬浮任务条返回时会通过 query 指定目标子页，这里同步一次，确保能直接回到对话流。
watch(
  () => route.query.aiSubTab,
  (nextTab) => {
    if (props.mode === 'sql-only') {
      activeSubTab.value = 'sql-lab'
      return
    }

    if (nextTab === 'chat-explorer' || nextTab === 'sql-lab') {
      activeSubTab.value = nextTab
    }
  }
)

// ChatExplorer 组件引用
const chatExplorerRef = ref<InstanceType<typeof ChatExplorer> | null>(null)

// 刷新 AI 配置（供父组件调用）
function refreshAIConfig() {
  chatExplorerRef.value?.refreshConfig()
}

// 暴露方法供父组件调用
defineExpose({
  refreshAIConfig,
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 子 Tab 导航 -->
    <SubTabs v-model="activeSubTab" :items="subTabs" persist-key="aiTab" />

    <!-- 子 Tab 内容 -->
    <div class="flex-1 min-h-0 overflow-hidden">
      <Transition name="fade" mode="out-in">
        <!-- 对话式探索 -->
        <ChatExplorer
          v-if="activeSubTab === 'chat-explorer'"
          ref="chatExplorerRef"
          class="h-full"
          :session-id="sessionId"
          :session-name="sessionName"
          :time-filter="timeFilter"
          :chat-type="chatType"
        />
        <!-- SQL 实验室 -->
        <SQLLabTab v-else class="h-full" :session-id="props.sessionId" />
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
