<script setup lang="ts">
import { ref, computed, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import CaptureButton from '@/components/common/CaptureButton.vue'
import TimeSelect from '@/components/common/TimeSelect.vue'
import AITab from '@/components/analysis/AITab.vue'
import { ChatExplorer } from '@/components/AIChat'
import OverviewTab from './components/OverviewTab.vue'
import ViewTab from './components/ViewTab.vue'
import QuotesTab from './components/QuotesTab.vue'
import MemberList from '@/components/common/member/MemberList.vue'
import NicknameHistoryEntry from './components/member/NicknameHistoryEntry.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SessionIndexModal from '@/components/analysis/SessionIndexModal.vue'
import IncrementalImportModal from '@/components/analysis/IncrementalImportModal.vue'
const MessageExportModal = defineAsyncComponent(() => import('@/components/MessageExport/MessageExportModal.vue'))
import ActionToolsPanel from '@/components/layout/ActionToolsPanel.vue'
import LoadingState from '@/components/UI/LoadingState.vue'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { useSettingsStore } from '@/stores/settings'
import { useSessionAnalysisPageBase, useSessionHeaderDescription } from '@/composables'

const { t } = useI18n()

const route = useRoute()
const router = useRouter()
const sessionStore = useSessionStore()
const layoutStore = useLayoutStore()
const settingsStore = useSettingsStore()
const { currentSessionId } = storeToRefs(sessionStore)

// 会话索引弹窗状态
const showSessionIndexModal = ref(false)

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
const allTabs = [
  { id: 'overview', labelKey: 'analysis.tabs.overview', icon: 'i-heroicons-chart-pie' },
  { id: 'view', labelKey: 'analysis.tabs.view', icon: 'i-heroicons-presentation-chart-bar' },
  { id: 'quotes', labelKey: 'analysis.tabs.groupQuotes', icon: 'i-heroicons-chat-bubble-bottom-center-text' },
  { id: 'ai-chat', labelKey: 'analysis.tabs.aiChat', icon: 'i-heroicons-chat-bubble-left-ellipsis' },
  { id: 'lab', labelKey: 'analysis.tabs.lab', icon: 'i-heroicons-beaker' },
]

// Tab 列表
const tabs = computed(() => allTabs)

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
  selectedYearForOverview,
  initialTimeState,
  loadData,
} = useSessionAnalysisPageBase({
  route,
  router,
  currentSessionId,
  selectSession: sessionStore.selectSession,
  defaultTab: settingsStore.defaultSessionTab,
  validTabIds: allTabs.map((tab) => tab.id),
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

const { headerDescription } = useSessionHeaderDescription({
  session,
  fullTimeRange,
  timeRangeValue,
  descriptionKey: 'analysis.groupChat.description',
})
</script>

<template>
  <div class="flex h-full flex-col bg-white dark:bg-gray-900" style="padding-top: var(--titlebar-area-height)">
    <!-- Loading State -->
    <LoadingState v-if="isInitialLoad" variant="page" :text="t('analysis.groupChat.loading')" />

    <!-- Content -->
    <template v-else-if="session">
      <!-- Header -->
      <PageHeader
        :title="session.name"
        :description="headerDescription"
        :avatar="session.groupAvatar"
        icon="i-heroicons-chat-bubble-left-right"
        icon-class="bg-primary-600 text-white dark:bg-primary-500 dark:text-white"
      >
        <template #actions>
          <UButton
            color="primary"
            variant="soft"
            size="sm"
            icon="i-heroicons-chat-bubble-bottom-center-text"
            @click="openChatRecordViewer"
          >
            {{ t('analysis.tooltip.chatViewer') }}
          </UButton>
          <CaptureButton />
        </template>
        <!-- Tabs -->
        <div class="mt-4 flex items-center justify-between gap-3">
          <div class="flex shrink-0 items-center gap-0.5 overflow-x-auto scrollbar-hide">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all"
              :class="[
                activeTab === tab.id
                  ? 'bg-pink-500 text-white dark:bg-pink-900/30 dark:text-pink-300'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
              ]"
              @click="activeTab = tab.id"
            >
              <UIcon :name="tab.icon" class="h-4 w-4" />
              <span class="whitespace-nowrap">{{ t(tab.labelKey) }}</span>
            </button>
          </div>
          <!-- AI 对话和实验室都不使用这里的时间范围筛选，因此在这些一级 Tab 下隐藏。 -->
          <TimeSelect
            v-model="timeRangeValue"
            :session-id="currentSessionId ?? undefined"
            :visible="activeTab !== 'ai-chat' && activeTab !== 'lab'"
            :initial-state="initialTimeState"
            @update:full-range="fullTimeRange = $event"
            @update:available-years="availableYears = $event"
          />
        </div>
      </PageHeader>

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
              :selected-year="selectedYearForOverview"
              :filtered-message-count="filteredMessageCount"
              :filtered-member-count="filteredMemberCount"
              :time-filter="timeFilter"
            />
            <ViewTab
              v-else-if="activeTab === 'view'"
              :key="'view-' + currentSessionId"
              :session-id="currentSessionId!"
              :time-filter="timeFilter"
            />
            <QuotesTab
              v-else-if="activeTab === 'quotes'"
              :key="'quotes-' + currentSessionId"
              :session-id="currentSessionId!"
              :time-filter="timeFilter"
            />
            <ChatExplorer
              v-else-if="activeTab === 'ai-chat'"
              :key="'ai-chat-' + currentSessionId"
              :session-id="currentSessionId!"
              :session-name="session.name"
              chat-type="group"
            />
            <AITab
              v-else-if="activeTab === 'lab'"
              :key="'lab-' + currentSessionId"
              :session-id="currentSessionId!"
              :session-name="session.name"
              chat-type="group"
              mode="sql-only"
            />
          </Transition>
        </div>
      </div>

      <!-- 右侧工具面板（fixed 定位，不占用页面空间） -->
      <ActionToolsPanel
        @open-incremental-import="showIncrementalImportModal = true"
        @open-session-index="showSessionIndexModal = true"
        @open-member-management="showMemberManagementModal = true"
        @open-message-export="showMessageExportModal = true"
      />
    </template>

    <!-- Empty State -->
    <div v-else class="flex h-full items-center justify-center">
      <p class="text-gray-500">{{ t('analysis.groupChat.loadError') }}</p>
    </div>

    <!-- 会话索引弹窗（内部自动检测并弹出） -->
    <SessionIndexModal v-if="currentSessionId" v-model="showSessionIndexModal" :session-id="currentSessionId" />

    <!-- 增量导入弹窗 -->
    <IncrementalImportModal
      v-if="currentSessionId && session"
      v-model="showIncrementalImportModal"
      :session-id="currentSessionId"
      :session-name="session.name"
      @imported="loadData"
    />

    <!-- 导出聊天记录弹窗 -->
    <MessageExportModal v-if="currentSessionId" v-model="showMessageExportModal" />

    <!-- 成员管理弹窗 -->
    <UModal v-if="currentSessionId" v-model:open="showMemberManagementModal" :ui="{ content: 'max-w-6xl h-[85vh]' }">
      <template #content>
        <div class="flex h-full flex-col overflow-hidden bg-white dark:bg-gray-900">
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
            <MemberList :session-id="currentSessionId" :show-header="false" @data-changed="loadData" />
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
