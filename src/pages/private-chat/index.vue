<script setup lang="ts">
import { ref, onMounted, watch, computed, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { AnalysisSession, MessageType } from '@/types/base'
import type { MemberActivity, HourlyActivity, DailyActivity } from '@/types/analysis'
import CaptureButton from '@/components/common/CaptureButton.vue'
import TimeSelect from '@/components/common/TimeSelect.vue'
import AITab from '@/components/analysis/AITab.vue'
import { ChatExplorer } from '@/components/AIChat'
import OverviewTab from './components/OverviewTab.vue'
import ViewTab from './components/ViewTab.vue'
import QuotesTab from './components/QuotesTab.vue'
import MemberTab from './components/MemberTab.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SessionIndexModal from '@/components/analysis/SessionIndexModal.vue'
import IncrementalImportModal from '@/components/analysis/IncrementalImportModal.vue'
const MessageExportModal = defineAsyncComponent(() => import('@/components/MessageExport/MessageExportModal.vue'))
import LoadingState from '@/components/UI/LoadingState.vue'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { useSettingsStore } from '@/stores/settings'
import { useTimeSelect } from '@/composables'

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

// 打开聊天记录查看器
function openChatRecordViewer() {
  layoutStore.openChatRecordDrawer({})
}

// 数据状态
const isLoading = ref(true)
const session = ref<AnalysisSession | null>(null)
const memberActivity = ref<MemberActivity[]>([])
const hourlyActivity = ref<HourlyActivity[]>([])
const dailyActivity = ref<DailyActivity[]>([])
const messageTypes = ref<Array<{ type: MessageType; count: number }>>([])
const isInitialLoad = ref(true)

// Tab 配置 - 私聊包含总览、视图、语录、成员、AI 对话和实验室
const tabs = [
  { id: 'overview', labelKey: 'analysis.tabs.overview', icon: 'i-heroicons-chart-pie' },
  { id: 'view', labelKey: 'analysis.tabs.view', icon: 'i-heroicons-presentation-chart-bar' },
  { id: 'quotes', labelKey: 'analysis.tabs.quotes', icon: 'i-heroicons-chat-bubble-left-right' },
  { id: 'member', labelKey: 'analysis.tabs.member', icon: 'i-heroicons-user-group' },
  { id: 'ai-chat', labelKey: 'analysis.tabs.aiChat', icon: 'i-heroicons-chat-bubble-left-ellipsis' },
  { id: 'lab', labelKey: 'analysis.tabs.lab', icon: 'i-heroicons-beaker' },
]

function resolveActiveTabFromRoute(): string {
  const routeTab = route.query.tab as string | undefined
  if (routeTab && tabs.some((tab) => tab.id === routeTab)) return routeTab
  return settingsStore.defaultSessionTab
}

const activeTab = ref(resolveActiveTabFromRoute())

// 时间范围筛选（composable 统一管理状态、派生计算、URL 同步）
const { timeRangeValue, fullTimeRange, timeFilter, selectedYearForOverview, initialTimeState } = useTimeSelect(
  route,
  router,
  {
    activeTab,
    isInitialLoad,
    currentSessionId,
    onTimeRangeChange: () => loadAnalysisData(),
  }
)

// 当前筛选后的消息总数
const filteredMessageCount = computed(() => {
  return memberActivity.value.reduce((sum, m) => sum + m.messageCount, 0)
})

// 当前筛选后的活跃成员数
const filteredMemberCount = computed(() => {
  return memberActivity.value.filter((m) => m.messageCount > 0).length
})

// Sync route param to store
function syncSession() {
  const id = route.params.id as string
  if (id) {
    sessionStore.selectSession(id)
    // If selection failed (e.g. invalid ID), redirect to home
    if (sessionStore.currentSessionId !== id) {
      router.replace('/')
    }
  }
}

// 加载基础数据（仅会话信息，时间范围由 TimeSelect 内部拉取）
async function loadBaseData() {
  if (!currentSessionId.value) return

  try {
    const sessionData = await window.chatApi.getSession(currentSessionId.value)
    session.value = sessionData
  } catch (error) {
    console.error('加载基础数据失败:', error)
  }
}

// 加载分析数据（受时间范围筛选影响）
async function loadAnalysisData() {
  if (!currentSessionId.value) return

  isLoading.value = true

  try {
    const filter = timeFilter.value

    const [members, hourly, daily, types] = await Promise.all([
      window.chatApi.getMemberActivity(currentSessionId.value, filter),
      window.chatApi.getHourlyActivity(currentSessionId.value, filter),
      window.chatApi.getDailyActivity(currentSessionId.value, filter),
      window.chatApi.getMessageTypeDistribution(currentSessionId.value, filter),
    ])

    memberActivity.value = members
    hourlyActivity.value = hourly
    dailyActivity.value = daily
    messageTypes.value = types
  } catch (error) {
    console.error('加载分析数据失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 加载所有数据
async function loadData() {
  if (!currentSessionId.value) return

  isInitialLoad.value = true
  await loadBaseData()
  isInitialLoad.value = false
}

// 监听路由参数变化
watch(
  () => route.params.id,
  () => {
    activeTab.value = resolveActiveTabFromRoute()
    syncSession()
  }
)

watch(
  () => route.query.tab,
  () => {
    activeTab.value = resolveActiveTabFromRoute()
  }
)

// 监听会话变化（切换会话时由 TimeSelect 自行发出新范围，避免 Tab Content 双重重建）
watch(
  currentSessionId,
  () => {
    loadData()
  },
  { immediate: true }
)

// 获取对方头像
const otherMemberAvatar = computed(() => {
  if (!session.value || memberActivity.value.length === 0) return null

  // 1. 优先尝试排除 ownerId
  if (session.value.ownerId) {
    const other = memberActivity.value.find((m) => m.platformId !== session.value?.ownerId)
    if (other?.avatar) return other.avatar
  }

  // 2. 尝试匹配会话名称 (通常私聊名称就是对方昵称)
  const sameName = memberActivity.value.find((m) => m.name === session.value?.name)
  if (sameName?.avatar) return sameName.avatar

  // 3. 如果只有两个成员，取另一个
  if (memberActivity.value.length === 2) {
    // 这里很难判断谁是"另一个"，因为不知道谁是"我"
    // 但通常 memberActivity 是按消息数排序的，或者按 ID 排序
    // 暂时不盲目取
  }

  return null
})

onMounted(() => {
  syncSession()
})
</script>

<template>
  <div class="flex h-full flex-col bg-white dark:bg-gray-900" style="padding-top: var(--titlebar-area-height)">
    <!-- Loading State -->
    <LoadingState v-if="isInitialLoad" variant="page" :text="t('analysis.privateChat.loading')" />

    <!-- Content -->
    <template v-else-if="session">
      <!-- Header -->
      <PageHeader
        :title="session.name"
        :description="
          t('analysis.privateChat.description', {
            dateRange: timeRangeValue?.displayLabel ?? '',
            messageCount: timeRangeValue?.isFullRange !== false ? session.messageCount : filteredMessageCount,
          })
        "
        :avatar="otherMemberAvatar"
        icon="i-heroicons-user"
        icon-class="bg-pink-600 text-white dark:bg-pink-500 dark:text-white"
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
          <!-- AI 对话、实验室和成员页都不使用这里的时间范围筛选，因此在这些一级 Tab 下隐藏。 -->
          <TimeSelect
            v-model="timeRangeValue"
            :session-id="currentSessionId ?? undefined"
            :visible="activeTab !== 'ai-chat' && activeTab !== 'lab' && activeTab !== 'member'"
            :initial-state="initialTimeState"
            @update:full-range="fullTimeRange = $event"
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
              :message-types="messageTypes"
              :hourly-activity="hourlyActivity"
              :daily-activity="dailyActivity"
              :time-range="fullTimeRange"
              :selected-year="selectedYearForOverview"
              :filtered-message-count="filteredMessageCount"
              :filtered-member-count="filteredMemberCount"
              :time-filter="timeFilter"
              @open-session-index="showSessionIndexModal = true"
              @open-incremental-import="showIncrementalImportModal = true"
              @open-message-export="showMessageExportModal = true"
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
            <MemberTab
              v-else-if="activeTab === 'member'"
              :key="'member-' + currentSessionId"
              :session-id="currentSessionId!"
            />
            <ChatExplorer
              v-else-if="activeTab === 'ai-chat'"
              :key="'ai-chat-' + currentSessionId"
              :session-id="currentSessionId!"
              :session-name="session.name"
              chat-type="private"
            />
            <AITab
              v-else-if="activeTab === 'lab'"
              :key="'lab-' + currentSessionId"
              :session-id="currentSessionId!"
              :session-name="session.name"
              chat-type="private"
              mode="sql-only"
            />
          </Transition>
        </div>
      </div>
    </template>

    <!-- Empty State -->
    <div v-else class="flex h-full items-center justify-center">
      <p class="text-gray-500">{{ t('analysis.privateChat.loadError') }}</p>
    </div>

    <!-- 会话索引弹窗（内部自动检测并弹出） -->
    <SessionIndexModal v-if="currentSessionId" v-model="showSessionIndexModal" :session-id="currentSessionId" />

    <!-- 增量导入弹窗 -->
    <IncrementalImportModal
      v-if="currentSessionId && session"
      v-model="showIncrementalImportModal"
      :session-id="currentSessionId"
      :session-name="session.name"
      @imported="loadAnalysisData"
    />

    <!-- 导出聊天记录弹窗 -->
    <MessageExportModal v-if="currentSessionId" v-model="showMessageExportModal" />
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
