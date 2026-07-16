<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { SectionTabs } from '@/components/navigation'
import UserSelect from '@/components/common/UserSelect.vue'
import { CatchphraseTab, HotRepeatTab } from '@/components/analysis/quotes'
import { isFeatureSupported, type LocaleType } from '@/i18n'
import type { TimeFilter } from '@openchatlab/shared-types'
import OverallRankingTab from './OverallRankingTab.vue'

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const { t, locale } = useI18n()

const activeSubTab = ref('overall')
const selectedMemberId = ref<number | null>(null)

const supportsGroupRanking = computed(() => isFeatureSupported('groupRanking', locale.value as LocaleType))

const subTabs = computed(() => {
  const tabs = supportsGroupRanking.value
    ? [{ id: 'overall', label: t('analysis.subTabs.ranking.overall'), icon: 'i-heroicons-trophy' }]
    : []

  return [
    ...tabs,
    { id: 'hot-repeat', label: t('analysis.subTabs.quotes.hotRepeat'), icon: 'i-heroicons-sparkles' },
    {
      id: 'catchphrase',
      label: t('analysis.subTabs.quotes.catchphrase'),
      icon: 'i-heroicons-chat-bubble-bottom-center-text',
    },
  ]
})

// 榜单统计只接受时间范围；成员筛选仅用于口头禅。
const rankingTimeFilter = computed(() => ({
  startTs: props.timeFilter?.startTs,
  endTs: props.timeFilter?.endTs,
}))

const catchphraseTimeFilter = computed(() => ({
  ...rankingTimeFilter.value,
  memberId: selectedMemberId.value,
}))

watch(
  subTabs,
  (tabs) => {
    if (!tabs.some((tab) => tab.id === activeSubTab.value)) {
      activeSubTab.value = tabs[0]?.id ?? 'hot-repeat'
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="flex h-full flex-col">
    <SectionTabs v-model="activeSubTab" :items="subTabs" persist-key="groupRankingTab">
      <template #right>
        <UserSelect v-if="activeSubTab === 'catchphrase'" v-model="selectedMemberId" :session-id="props.sessionId" />
      </template>
    </SectionTabs>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <Transition name="fade" mode="out-in">
        <OverallRankingTab
          v-if="activeSubTab === 'overall'"
          :session-id="props.sessionId"
          :time-filter="rankingTimeFilter"
        />
        <HotRepeatTab
          v-else-if="activeSubTab === 'hot-repeat'"
          :session-id="props.sessionId"
          :time-filter="rankingTimeFilter"
        />
        <CatchphraseTab
          v-else-if="activeSubTab === 'catchphrase'"
          :session-id="props.sessionId"
          :time-filter="catchphraseTimeFilter"
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
