<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { SectionTabs } from '@/components/navigation'
import UserSelect from '@/components/common/UserSelect.vue'
import PrivateRelationshipView from '@/components/analysis/relationships/PrivateRelationshipView.vue'
import TypeAnalysisView from '@/components/analysis/message/TypeAnalysisView.vue'
import TimeAnalysisView from '@/components/analysis/message/TimeAnalysisView.vue'
import { LanguagePreferenceTab, WordcloudTab } from '@/components/analysis/quotes'
import type { TimeFilter } from '@openchatlab/shared-types'
import GroupRelationshipInsights from './GroupRelationshipInsights.vue'

const props = defineProps<{
  sessionId: string
  sessionName?: string
  sessionType: string
  timeFilter?: TimeFilter
}>()

const { t } = useI18n()
const isPrivateChat = computed(() => props.sessionType === 'private')
const activeSubTab = ref(isPrivateChat.value ? 'relationship' : 'type-analysis')
const selectedMemberId = ref<number | null>(null)
const persistKey = computed(() => (isPrivateChat.value ? 'webWasmPrivateInsightsTab' : 'webWasmGroupInsightsTab'))
const subTabs = computed(() =>
  isPrivateChat.value
    ? [
        { id: 'relationship', label: t('analysis.subTabs.insights.relationship'), icon: 'i-heroicons-heart' },
        { id: 'type-analysis', label: t('analysis.subTabs.insights.typeAnalysis'), icon: 'i-heroicons-chart-pie' },
        { id: 'time-analysis', label: t('analysis.subTabs.insights.timeAnalysis'), icon: 'i-heroicons-clock' },
        { id: 'topic', label: t('analysis.subTabs.insights.topic'), icon: 'i-heroicons-cloud' },
        {
          id: 'language-preference',
          label: t('analysis.subTabs.insights.languagePreference'),
          icon: 'i-heroicons-language',
        },
      ]
    : [
        { id: 'type-analysis', label: t('analysis.subTabs.insights.typeAnalysis'), icon: 'i-heroicons-chart-pie' },
        { id: 'time-analysis', label: t('analysis.subTabs.insights.timeAnalysis'), icon: 'i-heroicons-clock' },
        { id: 'topic', label: t('analysis.subTabs.insights.topic'), icon: 'i-heroicons-cloud' },
        {
          id: 'group-relationships',
          label: t('analysis.subTabs.insights.groupRelationships'),
          icon: 'i-heroicons-heart',
        },
      ]
)
const viewTimeFilter = computed(() => ({ ...props.timeFilter, memberId: selectedMemberId.value }))
</script>

<template>
  <div class="flex h-full flex-col">
    <SectionTabs v-model="activeSubTab" :items="subTabs" :persist-key="persistKey">
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

    <div class="min-h-0 flex-1 overflow-auto">
      <Transition name="fade" mode="out-in">
        <PrivateRelationshipView
          v-if="activeSubTab === 'relationship'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
        />
        <TypeAnalysisView
          v-else-if="activeSubTab === 'type-analysis'"
          :key="selectedMemberId ?? 'all'"
          :session-id="props.sessionId"
          :session-name="props.sessionName"
          :time-filter="viewTimeFilter"
        />
        <TimeAnalysisView
          v-else-if="activeSubTab === 'time-analysis'"
          :key="selectedMemberId ?? 'all'"
          :session-id="props.sessionId"
          :session-name="props.sessionName"
          :time-filter="viewTimeFilter"
        />
        <WordcloudTab
          v-else-if="activeSubTab === 'topic'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
          :show-shared-topics="isPrivateChat"
          :enable-node-nlp-features="false"
          :enable-record-navigation="false"
        />
        <LanguagePreferenceTab
          v-else-if="activeSubTab === 'language-preference'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
          :enable-record-navigation="false"
        />
        <GroupRelationshipInsights
          v-else-if="activeSubTab === 'group-relationships'"
          :key="selectedMemberId ?? 'all'"
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
