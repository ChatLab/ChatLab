<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SectionTabs } from '@/components/navigation'
import UserSelect from '@/components/common/UserSelect.vue'
import TypeAnalysisView from '@/components/analysis/message/TypeAnalysisView.vue'
import TimeAnalysisView from '@/components/analysis/message/TimeAnalysisView.vue'
import RankingView from '@/components/analysis/ranking/RankingView.vue'
import GroupRelationships from './view/GroupRelationships.vue'
import { WordcloudTab, CatchphraseTab, HotRepeatTab } from '@/components/analysis/quotes'
import { isFeatureSupported, type LocaleType } from '@/i18n'
import type { TimeFilter } from '@openchatlab/shared-types'

const { t, locale } = useI18n()

const props = defineProps<{
  sessionId: string
  sessionName?: string
  timeFilter?: TimeFilter
}>()

const subTabs = computed(() => {
  const tabs = [
    { id: 'type-analysis', label: t('analysis.subTabs.view.typeAnalysis'), icon: 'i-heroicons-chart-pie' },
    { id: 'time-analysis', label: t('analysis.subTabs.view.timeAnalysis'), icon: 'i-heroicons-clock' },
    { id: 'topic', label: t('analysis.subTabs.view.topic'), icon: 'i-heroicons-cloud' },
    { id: 'group-relationships', label: t('analysis.subTabs.view.groupRelationships'), icon: 'i-heroicons-heart' },
    { id: 'hot-repeat', label: t('analysis.subTabs.quotes.hotRepeat'), icon: 'i-heroicons-fire' },
    {
      id: 'catchphrase',
      label: t('analysis.subTabs.quotes.catchphrase'),
      icon: 'i-heroicons-chat-bubble-bottom-center-text',
    },
  ]
  if (isFeatureSupported('groupRanking', locale.value as LocaleType)) {
    tabs.splice(2, 0, { id: 'ranking', label: t('analysis.subTabs.view.ranking'), icon: 'i-heroicons-trophy' })
  }
  return tabs
})

const activeSubTab = ref('type-analysis')

const selectedMemberId = ref<number | null>(null)

const viewTimeFilter = computed(() => ({
  ...props.timeFilter,
  memberId: selectedMemberId.value,
}))
</script>

<template>
  <div class="flex h-full flex-col">
    <SectionTabs v-model="activeSubTab" :items="subTabs" persist-key="groupViewTab">
      <template #right>
        <UserSelect v-if="activeSubTab !== 'topic'" v-model="selectedMemberId" :session-id="props.sessionId" />
      </template>
    </SectionTabs>

    <div class="flex-1 min-h-0 overflow-y-auto">
      <Transition name="fade" mode="out-in">
        <TypeAnalysisView
          v-if="activeSubTab === 'type-analysis'"
          :session-id="props.sessionId"
          :session-name="props.sessionName"
          :time-filter="viewTimeFilter"
        />
        <TimeAnalysisView
          v-else-if="activeSubTab === 'time-analysis'"
          :session-id="props.sessionId"
          :session-name="props.sessionName"
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
        <RankingView
          v-else-if="activeSubTab === 'ranking'"
          :session-id="props.sessionId"
          :time-filter="viewTimeFilter"
        />
        <HotRepeatTab
          v-else-if="activeSubTab === 'hot-repeat'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
        />
        <CatchphraseTab
          v-else-if="activeSubTab === 'catchphrase'"
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
