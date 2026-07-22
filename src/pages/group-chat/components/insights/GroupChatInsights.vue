<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SectionTabs } from '@/components/navigation'
import UserSelect from '@/components/common/UserSelect.vue'
import TypeAnalysisView from '@/components/analysis/message/TypeAnalysisView.vue'
import TimeAnalysisView from '@/components/analysis/message/TimeAnalysisView.vue'
import GroupRelationships from './GroupRelationships.vue'
import { WordcloudTab } from '@/components/analysis/quotes'
import type { TimeFilter } from '@openchatlab/shared-types'
import type { AnalysisSession, MessageType } from '@/types/base'
import type { DailyActivity, HourlyActivity, MemberActivity } from '@/types/analysis'
import GroupChatOverview from './GroupChatOverview.vue'

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
  session: AnalysisSession
  memberActivity: MemberActivity[]
  messageTypes: Array<{ type: MessageType; count: number }>
  hourlyActivity: HourlyActivity[]
  dailyActivity: DailyActivity[]
  timeRange: { start: number; end: number } | null
  filteredMessageCount: number
  filteredMemberCount: number
  timeFilter?: TimeFilter
}>()

const subTabs = computed(() => {
  return [
    { id: 'overview', label: t('analysis.tabs.overview'), icon: 'i-heroicons-squares-2x2' },
    { id: 'type-analysis', label: t('analysis.subTabs.insights.typeAnalysis'), icon: 'i-heroicons-chart-pie' },
    { id: 'time-analysis', label: t('analysis.subTabs.insights.timeAnalysis'), icon: 'i-heroicons-clock' },
    { id: 'topic', label: t('analysis.subTabs.insights.topic'), icon: 'i-heroicons-cloud' },
    {
      id: 'group-relationships',
      label: t('analysis.subTabs.insights.groupRelationships'),
      icon: 'i-heroicons-heart',
    },
  ]
})

const activeSubTab = ref('overview')

const selectedMemberId = ref<number | null>(null)

const viewTimeFilter = computed(() => ({
  ...props.timeFilter,
  memberId: selectedMemberId.value,
}))
</script>

<template>
  <div class="flex h-full flex-col">
    <SectionTabs v-model="activeSubTab" :items="subTabs" persist-key="groupInsightsTab">
      <template #right>
        <UserSelect
          v-if="
            activeSubTab === 'type-analysis' ||
            activeSubTab === 'time-analysis' ||
            activeSubTab === 'group-relationships'
          "
          v-model="selectedMemberId"
          :session-id="props.sessionId"
        />
      </template>
    </SectionTabs>

    <div class="flex-1 min-h-0 overflow-y-auto">
      <Transition name="fade" mode="out-in">
        <GroupChatOverview
          v-if="activeSubTab === 'overview'"
          :session="props.session"
          :member-activity="props.memberActivity"
          :message-types="props.messageTypes"
          :hourly-activity="props.hourlyActivity"
          :daily-activity="props.dailyActivity"
          :time-range="props.timeRange"
          :filtered-message-count="props.filteredMessageCount"
          :filtered-member-count="props.filteredMemberCount"
          :time-filter="props.timeFilter"
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
        <WordcloudTab
          v-else-if="activeSubTab === 'topic'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
        />
        <GroupRelationships
          v-else-if="activeSubTab === 'group-relationships'"
          :session-id="props.sessionId"
          :time-filter="viewTimeFilter"
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
