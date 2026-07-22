<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import LoadingState from '@/components/UI/LoadingState.vue'
import SessionAnalysisHeader from '@/components/layout/session/SessionAnalysisHeader.vue'
import { useSessionAnalysisPageBase } from '@/composables'
import { useSessionStore } from '@/stores/session'
import GroupOverview from '../components/session/insights/GroupOverview.vue'
import PrivateOverview from '../components/session/insights/PrivateOverview.vue'
import SessionInsights from '../components/session/insights/SessionInsights.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const sessionStore = useSessionStore()
const { currentSessionId } = storeToRefs(sessionStore)

const tabs = [
  { id: 'overview', labelKey: 'analysis.tabs.overview', icon: 'i-heroicons-chart-pie' },
  { id: 'view', labelKey: 'analysis.tabs.insights', icon: 'i-heroicons-presentation-chart-bar' },
]

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
  timeFilter,
  initialTimeState,
} = useSessionAnalysisPageBase({
  route,
  router,
  currentSessionId,
  selectSession: sessionStore.selectSession,
  defaultTab: 'overview',
  validTabIds: tabs.map((tab) => tab.id),
})

const isPrivateChat = computed(() => session.value?.type === 'private')
const filteredMessageCount = computed(() =>
  memberActivity.value.reduce((total, member) => total + member.messageCount, 0)
)
const filteredMemberCount = computed(() => memberActivity.value.filter((member) => member.messageCount > 0).length)
const otherMemberAvatar = computed(() => {
  if (!session.value || memberActivity.value.length === 0) return null

  if (session.value.ownerId) {
    const otherMember = memberActivity.value.find((member) => member.platformId !== session.value?.ownerId)
    if (otherMember?.avatar) return otherMember.avatar
  }

  return memberActivity.value.find((member) => member.name === session.value?.name)?.avatar ?? null
})
const loadErrorText = computed(() =>
  t(route.name === 'private-chat' ? 'analysis.privateChat.loadError' : 'analysis.groupChat.loadError')
)
</script>

<template>
  <div class="flex h-full flex-col dark:bg-page-dark" style="padding-top: var(--titlebar-area-height)">
    <LoadingState
      v-if="isInitialLoad"
      variant="page"
      :text="t(route.name === 'private-chat' ? 'analysis.privateChat.loading' : 'analysis.groupChat.loading')"
    />

    <template v-else-if="session">
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
      />

      <div class="relative flex-1 overflow-y-auto">
        <LoadingState v-if="isLoading" variant="overlay" :text="t('common.loading')" />

        <PrivateOverview
          v-if="activeTab === 'overview' && isPrivateChat"
          :key="'private-overview-' + currentSessionId"
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
        <GroupOverview
          v-else-if="activeTab === 'overview'"
          :key="'group-overview-' + currentSessionId"
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
        <SessionInsights
          v-else-if="activeTab === 'view'"
          :key="'insights-' + currentSessionId"
          :session-id="currentSessionId!"
          :session-name="session.name"
          :session-type="session.type"
          :time-filter="timeFilter"
        />
      </div>
    </template>

    <div v-else class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p class="text-sm text-gray-500 dark:text-gray-400">{{ loadErrorText }}</p>
      <UButton size="sm" variant="soft" to="/">{{ t('common.back') }}</UButton>
    </div>
  </div>
</template>
