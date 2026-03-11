<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { SubTabs } from '@/components/UI'
import ChatExplorer from './AIChat/ChatExplorer.vue'
import SQLLabTab from './SQLLabTab.vue'

const { t, locale } = useI18n()

// 关注链接配置
const followLink = computed(() => {
  if (locale.value.startsWith('zh')) {
    return {
      url: 'https://www.xiaohongshu.com/user/profile/6841741e000000001d0091b4',
      name: '@地瓜',
    }
  }
  return {
    url: 'https://x.com/hellodigua',
    name: '@digua',
  }
})

// Props
const props = defineProps<{
  sessionId: string
  sessionName: string
  timeFilter?: { startTs: number; endTs: number }
  chatType?: 'group' | 'private'
}>()

const route = useRoute()

// 判断是否为群聊（通过路由名称判断）
const isGroupChat = computed(() => route.name === 'group-chat')

// 仅群聊显示的功能 ID
const groupOnlyTabs = ['mbti', 'cyber-friend', 'campus']

// 所有子 Tab 配置
const allSubTabs = computed(() => [
  { id: 'chat-explorer', label: t('ai.tab.chatExplorer'), icon: 'i-heroicons-chat-bubble-left-ellipsis' },
  { id: 'sql-lab', label: t('ai.tab.sqlLab'), icon: 'i-heroicons-command-line' },
])

// 根据聊天类型过滤显示的子 Tab
const subTabs = computed(() => {
  if (isGroupChat.value) {
    // 群聊显示所有 Tab
    return allSubTabs.value
  }
  // 私聊过滤掉群聊专属功能
  return allSubTabs.value.filter((tab) => !groupOnlyTabs.includes(tab.id))
})

const activeSubTab = ref('chat-explorer')

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
        <SQLLabTab v-else-if="activeSubTab === 'sql-lab'" class="h-full" :session-id="props.sessionId" />

        <!-- 暂未实现的功能 -->
        <div
          v-else-if="['mbti', 'cyber-friend', 'campus'].includes(activeSubTab)"
          class="main-content flex h-full items-center justify-center p-6"
        >
          <div
            class="flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50"
          >
            <div class="text-center">
              <UIcon :name="subTabs.find((t) => t.id === activeSubTab)?.icon" class="mx-auto h-12 w-12 text-gray-400" />
              <p class="mt-3 text-sm font-medium text-gray-600 dark:text-gray-400">
                {{ t('ai.tab.featureInDev', { name: subTabs.find((tab) => tab.id === activeSubTab)?.label || '' }) }}
              </p>
              <p class="mt-1 max-w-md px-4 text-sm text-gray-500">
                {{ subTabs.find((tab) => tab.id === activeSubTab)?.desc || t('ai.tab.comingSoon') }}
              </p>

              <div class="mt-8 flex items-center justify-center gap-1 text-xs text-gray-400">
                <span>{{ t('ai.tab.followNotice') }}</span>
                <UButton
                  :to="followLink.url"
                  target="_blank"
                  variant="link"
                  :padded="false"
                  class="text-xs font-medium"
                >
                  {{ followLink.name }}
                </UButton>
              </div>
            </div>
          </div>
        </div>
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
