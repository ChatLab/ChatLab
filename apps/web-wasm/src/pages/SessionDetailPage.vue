<script setup lang="ts">
import { computed, defineAsyncComponent, provide, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { LoadingState } from '@/components/UI'
import InsightLoadingDots from '@/components/UI/InsightLoadingDots.vue'
import SessionAnalysisHeader from '@/components/layout/session/SessionAnalysisHeader.vue'
import { useSessionAnalysisPageBase } from '@/composables'
import { useSessionStore } from '@/stores/session'
import { useSettingsStore } from '@/stores/settings'
import SessionInsights from '../components/session/insights/SessionInsights.vue'

const WebAIChat = defineAsyncComponent(() => import('../components/ai/WebAIChat.vue'))

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const sessionStore = useSessionStore()
const settingsStore = useSettingsStore()
const { currentSessionId, isInitialized, sessions } = storeToRefs(sessionStore)

const tabs = [
  { id: 'insights', labelKey: 'analysis.tabs.insights', icon: 'i-heroicons-presentation-chart-bar' },
  { id: 'ai-chat', labelKey: 'analysis.tabs.aiChat', icon: 'i-heroicons-sparkles' },
]

const {
  activeTab,
  isLoading,
  isInitialLoad,
  isSessionSwitching,
  session,
  memberActivity,
  hourlyActivity,
  dailyActivity,
  messageTypes,
  timeRangeValue,
  fullTimeRange,
  timeFilter,
  initialTimeState,
  handleTimeRangeInitialized,
} = useSessionAnalysisPageBase({
  route,
  router,
  currentSessionId,
  selectSession: sessionStore.selectSession,
  defaultTab: settingsStore.defaultSessionTab,
  validTabIds: tabs.map((tab) => tab.id),
})

provide('session-switch-loading', isSessionSwitching)

const aiChatVisited = ref(false)
watch(
  activeTab,
  (tab) => {
    if (tab === 'ai-chat') aiChatVisited.value = true
  },
  { immediate: true }
)

const isPrivateChat = computed(() => session.value?.type === 'private')
const filteredMessageCount = computed(() =>
  memberActivity.value.reduce((total, member) => total + member.messageCount, 0)
)
const filteredMemberCount = computed(() => memberActivity.value.filter((member) => member.messageCount > 0).length)
const otherMemberAvatar = computed(() => {
  if (!session.value) return null
  if (session.value.memberAvatar) return session.value.memberAvatar
  if (memberActivity.value.length === 0) return null

  if (session.value.ownerId) {
    const otherMember = memberActivity.value.find((member) => member.platformId !== session.value?.ownerId)
    if (otherMember?.avatar) return otherMember.avatar
  }

  return memberActivity.value.find((member) => member.name === session.value?.name)?.avatar ?? null
})
const loadErrorText = computed(() =>
  t(route.name === 'private-chat' ? 'analysis.privateChat.loadError' : 'analysis.groupChat.loadError')
)

watch(
  () => sessions.value.find((item) => item.id === route.params.id),
  (catalogSession) => {
    if (!isInitialized.value) return
    if (!catalogSession) {
      session.value = null
      void router.replace('/')
      return
    }
    // 其他标签页重命名后，同步更新当前详情页标题，不必重新执行整组分析查询。
    if (session.value) session.value = catalogSession
  }
)
</script>

<template>
  <div class="relative flex h-full flex-col dark:bg-page-dark" style="padding-top: var(--titlebar-area-height)">
    <div
      v-if="isSessionSwitching"
      data-testid="session-switch-loading"
      class="absolute inset-0 z-20 flex cursor-wait items-center justify-center bg-page-bg/15 backdrop-blur-[1.5px] dark:bg-page-dark/15"
      :style="{ paddingTop: 'var(--titlebar-area-height)' }"
      role="status"
      aria-live="polite"
      :aria-label="t('common.loading')"
    >
      <InsightLoadingDots />
    </div>

    <template v-if="session">
      <SessionAnalysisHeader
        v-model:active-tab="activeTab"
        v-model:time-range-value="timeRangeValue"
        :title="session.name"
        :avatar="isPrivateChat ? otherMemberAvatar : session.groupAvatar"
        :icon="isPrivateChat ? 'i-heroicons-user' : 'i-heroicons-chat-bubble-left-right'"
        :icon-class="
          isPrivateChat
            ? 'bg-pink-600 text-white dark:bg-pink-500 dark:text-white'
            : 'bg-primary-600 text-white dark:bg-primary-500 dark:text-white'
        "
        :tabs="tabs"
        :current-session-id="currentSessionId"
        :initial-time-state="initialTimeState"
        :show-session-actions="false"
        @update:full-range="fullTimeRange = $event"
        @time-range-initialized="handleTimeRangeInitialized"
      />

      <div class="relative min-h-0 flex-1" :class="activeTab === 'ai-chat' ? 'overflow-hidden' : 'overflow-y-auto'">
        <LoadingState
          v-if="isLoading && activeTab !== 'ai-chat' && !isSessionSwitching"
          variant="overlay"
          :text="t('common.loading')"
        />

        <SessionInsights
          v-if="activeTab === 'insights'"
          :key="'insights-' + currentSessionId"
          :session-id="currentSessionId!"
          :session="session"
          :member-activity="memberActivity"
          :message-types="messageTypes"
          :hourly-activity="hourlyActivity"
          :daily-activity="dailyActivity"
          :time-range="fullTimeRange"
          :filtered-message-count="filteredMessageCount"
          :filtered-member-count="filteredMemberCount"
          :time-filter="timeFilter"
        />

        <WebAIChat
          v-if="aiChatVisited && currentSessionId"
          v-show="activeTab === 'ai-chat'"
          :key="'ai-chat-' + currentSessionId"
          :session-id="currentSessionId"
        />
      </div>
    </template>

    <div v-else-if="!isInitialLoad" class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p class="text-sm text-gray-500 dark:text-gray-400">{{ loadErrorText }}</p>
      <UButton size="sm" variant="soft" to="/">{{ t('common.back') }}</UButton>
    </div>
  </div>
</template>
