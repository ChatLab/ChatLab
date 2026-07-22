<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SectionTabs } from '@/components/navigation'
import UserSelect from '@/components/common/UserSelect.vue'
import TypeAnalysisView from '@/components/analysis/message/TypeAnalysisView.vue'
import TimeAnalysisView from '@/components/analysis/message/TimeAnalysisView.vue'
import PrivateRelationshipView from '@/components/analysis/relationships/PrivateRelationshipView.vue'
import JourneyView from '@/components/analysis/journey/JourneyView.vue'
import DuoProfileView from '@/components/analysis/duo-profile/DuoProfileView.vue'
import { WordcloudTab, LanguagePreferenceTab } from '@/components/analysis/quotes'
import type { TimeFilter } from '@openchatlab/shared-types'
import type { AnalysisSession, MessageType } from '@/types/base'
import type { DailyActivity, HourlyActivity } from '@/types/analysis'
import PrivateChatOverview from './PrivateChatOverview.vue'

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
  session: AnalysisSession
  messageTypes: Array<{ type: MessageType; count: number }>
  hourlyActivity: HourlyActivity[]
  dailyActivity: DailyActivity[]
  timeRange: { start: number; end: number } | null
  filteredMessageCount: number
  filteredMemberCount: number
  timeFilter?: TimeFilter
}>()

const subTabs = computed(() => [
  { id: 'overview', label: t('analysis.tabs.overview'), icon: 'i-heroicons-squares-2x2' },
  { id: 'duo-profile', label: t('analysis.subTabs.insights.duoProfile'), icon: 'i-heroicons-user-group' },
  { id: 'relationship', label: t('analysis.subTabs.insights.relationship'), icon: 'i-heroicons-heart' },
  { id: 'journey', label: t('analysis.subTabs.insights.journey'), icon: 'i-heroicons-map' },
  { id: 'type-analysis', label: t('analysis.subTabs.insights.typeAnalysis'), icon: 'i-heroicons-chart-pie' },
  { id: 'time-analysis', label: t('analysis.subTabs.insights.timeAnalysis'), icon: 'i-heroicons-clock' },
  { id: 'topic', label: t('analysis.subTabs.insights.topic'), icon: 'i-heroicons-cloud' },
  {
    id: 'language-preference',
    label: t('analysis.subTabs.insights.languagePreference'),
    icon: 'i-heroicons-language',
  },
])

const activeSubTab = ref('overview')

// 成员筛选（用于类型/时间分析）
const selectedMemberId = ref<number | null>(null)

const viewTimeFilter = computed(() => ({
  ...props.timeFilter,
  memberId: selectedMemberId.value,
}))
</script>

<template>
  <div class="flex h-full flex-col">
    <SectionTabs v-model="activeSubTab" :items="subTabs" persist-key="privateInsightsTab">
      <template #right>
        <UserSelect
          v-if="activeSubTab === 'type-analysis' || activeSubTab === 'time-analysis'"
          v-model="selectedMemberId"
          :session-id="props.sessionId"
        />
      </template>
    </SectionTabs>

    <div class="flex-1 min-h-0 overflow-auto">
      <Transition name="fade" mode="out-in">
        <PrivateChatOverview
          v-if="activeSubTab === 'overview'"
          :session="props.session"
          :message-types="props.messageTypes"
          :hourly-activity="props.hourlyActivity"
          :daily-activity="props.dailyActivity"
          :time-range="props.timeRange"
          :filtered-message-count="props.filteredMessageCount"
          :filtered-member-count="props.filteredMemberCount"
          :time-filter="props.timeFilter"
        />
        <DuoProfileView
          v-else-if="activeSubTab === 'duo-profile'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
          :time-range="props.timeRange"
        />
        <TypeAnalysisView
          v-else-if="activeSubTab === 'type-analysis'"
          :session-id="props.sessionId"
          :session-name="props.session.name"
          :time-filter="viewTimeFilter"
        />
        <TimeAnalysisView
          v-else-if="activeSubTab === 'time-analysis'"
          :session-id="props.sessionId"
          :session-name="props.session.name"
          :time-filter="viewTimeFilter"
        />
        <PrivateRelationshipView
          v-else-if="activeSubTab === 'relationship'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
        />
        <JourneyView
          v-else-if="activeSubTab === 'journey'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
          :time-range="props.timeRange"
        />
        <WordcloudTab
          v-else-if="activeSubTab === 'topic'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
          :show-shared-topics="true"
        />
        <LanguagePreferenceTab
          v-else-if="activeSubTab === 'language-preference'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
        />
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
