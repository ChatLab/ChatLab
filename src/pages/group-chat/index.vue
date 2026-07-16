<script setup lang="ts">
import { ref, computed, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import AITab from '@/components/analysis/AITab.vue'
import MemoryTab from '@/components/analysis/MemoryTab.vue'
import { DebugTab } from '@/components/DebugTab'
import { ChatExplorer } from '@/components/AIChat'
import OverviewTab from './components/OverviewTab.vue'
import ViewTab from './components/ViewTab.vue'
import MemberList from '@/components/common/member/MemberList.vue'
import NicknameHistoryEntry from './components/member/NicknameHistoryEntry.vue'
import SessionAnalysisHeader from '@/components/layout/session/SessionAnalysisHeader.vue'
import SemanticIndexSessionModal from '@/components/analysis/SemanticIndexSessionModal.vue'
import OwnerPromptModal from '@/components/analysis/member/OwnerPromptModal.vue'
import IncrementalImportModal from '@/components/analysis/IncrementalImportModal.vue'
const MessageExportModal = defineAsyncComponent(() => import('@/components/MessageExport/MessageExportModal.vue'))
import ActionToolsPanel from '@/components/layout/ActionToolsPanel.vue'
import LoadingState from '@/components/UI/LoadingState.vue'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { useSettingsStore } from '@/stores/settings'
import { useSessionAnalysisPageBase } from '@/composables'

const { t } = useI18n()

const route = useRoute()
const router = useRouter()
const sessionStore = useSessionStore()
const layoutStore = useLayoutStore()
const settingsStore = useSettingsStore()
const { currentSessionId } = storeToRefs(sessionStore)

const showSemanticIndexModal = ref(false)

// "我是谁"提示弹窗状态
const showOwnerPromptModal = ref(false)

// 增量导入弹窗状态
const showIncrementalImportModal = ref(false)

// 导出聊天记录弹窗状态
const showMessageExportModal = ref(false)

// 成员管理弹窗状态
const showMemberManagementModal = ref(false)

// 打开聊天记录查看器
function openChatRecordViewer() {
  layoutStore.openChatRecordDrawer({})
}

// Tab 配置
const baseTabs = [
  { id: 'overview', labelKey: 'analysis.tabs.overview', icon: 'i-heroicons-chart-pie' },
  { id: 'view', labelKey: 'analysis.tabs.view', icon: 'i-heroicons-presentation-chart-bar' },
  { id: 'ai-chat', labelKey: 'analysis.tabs.aiChat', icon: 'i-heroicons-chat-bubble-left-ellipsis' },
  // { id: 'memory', labelKey: 'analysis.tabs.memory', icon: 'i-heroicons-light-bulb' },
  { id: 'lab', labelKey: 'analysis.tabs.lab', icon: 'i-heroicons-beaker' },
]

// Tab 列表（Debug tab 仅在 debugMode 开启时显示）
const tabs = computed(() => {
  if (settingsStore.debugMode) {
    return [...baseTabs, { id: 'debug', labelKey: 'analysis.tabs.debug', icon: 'i-heroicons-bug-ant' }]
  }
  return baseTabs
})

const allTabIds = computed(() => tabs.value.map((tab) => tab.id))

const {
  activeTab,
  isLoading,
  isInitialLoad,
  session,
  memberActivity,
  hourlyActivity,
  dailyActivity,
  messageTypes,
  timeRangeValue,
  fullTimeRange,
  availableYears,
  timeFilter,
  initialTimeState,
  loadData,
} = useSessionAnalysisPageBase({
  route,
  router,
  currentSessionId,
  selectSession: sessionStore.selectSession,
  defaultTab: settingsStore.defaultSessionTab,
  validTabIds: allTabIds.value,
})

// 计算属性
const topMembers = computed(() => memberActivity.value.slice(0, 3))
const bottomMembers = computed(() => {
  if (memberActivity.value.length <= 1) return []
  return [...memberActivity.value].sort((a, b) => a.messageCount - b.messageCount).slice(0, 1)
})

// 当前筛选后的消息总数
const filteredMessageCount = computed(() => {
  return memberActivity.value.reduce((sum, m) => sum + m.messageCount, 0)
})

// 当前筛选后的活跃成员数
const filteredMemberCount = computed(() => {
  return memberActivity.value.filter((m) => m.messageCount > 0).length
})
</script>

<template>
  <div class="flex h-full flex-col dark:bg-page-dark" style="padding-top: var(--titlebar-area-height)">
    <!-- Loading State -->
    <LoadingState v-if="isInitialLoad" variant="page" :text="t('analysis.groupChat.loading')" />

    <!-- Content -->
    <template v-else-if="session">
      <SessionAnalysisHeader
        v-model:active-tab="activeTab"
        v-model:time-range-value="timeRangeValue"
        :title="session.name"
        :avatar="session.groupAvatar"
        icon="i-heroicons-chat-bubble-left-right"
        icon-class="bg-primary-600 text-white dark:bg-primary-500 dark:text-white"
        :tabs="tabs"
        :current-session-id="currentSessionId"
        :initial-time-state="initialTimeState"
        @open-incremental-import="showIncrementalImportModal = true"
        @open-member-management="showMemberManagementModal = true"
        @open-chat-record="openChatRecordViewer"
        @update:full-range="fullTimeRange = $event"
        @update:available-years="availableYears = $event"
      />

      <!-- Tab Content -->
      <div class="relative flex-1 overflow-y-auto">
        <!-- Loading Overlay -->
        <LoadingState v-if="isLoading" variant="overlay" />

        <div class="h-full">
          <Transition name="tab-slide" mode="out-in">
            <OverviewTab
              v-if="activeTab === 'overview'"
              :key="'overview-' + currentSessionId"
              :session="session"
              :member-activity="memberActivity"
              :top-members="topMembers"
              :bottom-members="bottomMembers"
              :message-types="messageTypes"
              :hourly-activity="hourlyActivity"
              :daily-activity="dailyActivity"
              :time-range="fullTimeRange"
              :filtered-message-count="filteredMessageCount"
              :filtered-member-count="filteredMemberCount"
              :time-filter="timeFilter"
            />
            <ViewTab
              v-else-if="activeTab === 'view'"
              :key="'view-' + currentSessionId"
              :session-id="currentSessionId!"
              :session-name="session.name"
              :time-filter="timeFilter"
            />
            <ChatExplorer
              v-else-if="activeTab === 'ai-chat'"
              :key="'ai-chat-' + currentSessionId"
              :session-id="currentSessionId!"
              :session-name="session.name"
              chat-type="group"
            />
            <MemoryTab
              v-else-if="activeTab === 'memory'"
              :key="'memory-' + currentSessionId"
              :session-id="currentSessionId!"
              :session-name="session.name"
            />
            <AITab
              v-else-if="activeTab === 'lab'"
              :key="'lab-' + currentSessionId"
              :session-id="currentSessionId!"
              :session-name="session.name"
              :time-filter="timeFilter"
              chat-type="group"
              mode="sql-only"
            />
            <DebugTab
              v-else-if="activeTab === 'debug'"
              :key="'debug-' + currentSessionId"
              :session-id="currentSessionId!"
            />
          </Transition>
        </div>
      </div>

      <ActionToolsPanel
        @open-incremental-import="showIncrementalImportModal = true"
        @open-semantic-index="showSemanticIndexModal = true"
        @open-member-management="showMemberManagementModal = true"
        @open-chat-record="openChatRecordViewer"
        @open-message-export="showMessageExportModal = true"
      />
    </template>

    <!-- Empty State -->
    <div v-else class="flex h-full items-center justify-center">
      <p class="text-gray-500">{{ t('analysis.groupChat.loadError') }}</p>
    </div>

    <!-- 语义索引弹窗（当前对话） -->
    <SemanticIndexSessionModal
      v-if="currentSessionId && session"
      v-model="showSemanticIndexModal"
      :session-id="currentSessionId"
      :message-count="session.messageCount"
    />

    <!-- "我是谁"提示弹窗（内部自动检测并弹出） -->
    <OwnerPromptModal
      v-if="currentSessionId && session"
      v-model="showOwnerPromptModal"
      :session-id="currentSessionId"
      chat-type="group"
      auto-check
    />

    <!-- 增量导入弹窗 -->
    <IncrementalImportModal
      v-if="currentSessionId && session"
      v-model="showIncrementalImportModal"
      :session-id="currentSessionId"
      :session-name="session.name"
      @imported="
        () => {
          loadData()
          sessionStore.loadSessions()
        }
      "
    />

    <!-- 导出聊天记录弹窗 -->
    <MessageExportModal v-if="currentSessionId" v-model="showMessageExportModal" />

    <!-- 成员管理弹窗 -->
    <UModal v-if="currentSessionId" v-model:open="showMemberManagementModal" :ui="{ content: 'max-w-6xl h-[85vh]' }">
      <template #content>
        <div class="flex h-full flex-col overflow-hidden bg-white dark:bg-page-dark">
          <div
            class="flex flex-none items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700"
          >
            <div>
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
                {{ t('analysis.tooltip.memberManagement') }}
              </h2>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ t('members.list.description', { count: session?.memberCount ?? 0 }) }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <NicknameHistoryEntry :session-id="currentSessionId" />
              <UButton variant="ghost" icon="i-heroicons-x-mark" size="sm" @click="showMemberManagementModal = false" />
            </div>
          </div>
          <div class="flex-1 overflow-hidden">
            <MemberList
              :session-id="currentSessionId"
              :show-header="false"
              chat-type="group"
              @data-changed="loadData"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.tab-slide-enter-active,
.tab-slide-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.tab-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.tab-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
