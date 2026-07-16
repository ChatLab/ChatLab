<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MentionAnalysis } from '@/types/analysis'
import { useDataService } from '@/services'
import { RankListPro } from '@/components/charts'
import type { RankItem } from '@/components/charts'
import { SectionCard, EmptyState, LoadingState, Tabs } from '@/components/UI'
import type { TimeFilter } from '@openchatlab/shared-types'

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const mentionAnalysis = ref<MentionAnalysis | null>(null)
const isLoadingMention = ref(false)

async function loadMentionAnalysis() {
  if (!props.sessionId) return
  isLoadingMention.value = true
  try {
    mentionAnalysis.value = await useDataService().getMentionAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('加载 @ 互动分析失败:', error)
  } finally {
    isLoadingMention.value = false
  }
}

const mentionerRankData = computed<RankItem[]>(() => {
  if (!mentionAnalysis.value) return []
  return mentionAnalysis.value.topMentioners.map((member) => ({
    id: member.memberId.toString(),
    name: member.name,
    value: member.count,
    percentage: member.percentage,
  }))
})

const mentionedRankData = computed<RankItem[]>(() => {
  if (!mentionAnalysis.value) return []
  return mentionAnalysis.value.topMentioned.map((member) => ({
    id: member.memberId.toString(),
    name: member.name,
    value: member.count,
    percentage: member.percentage,
  }))
})

type MentionRankMode = 'mentioners' | 'mentioned'

const activeMentionRank = ref<MentionRankMode>('mentioners')

const mentionRankTabs = computed(() => [
  { label: t('members.relationships.rankModes.mentioners'), value: 'mentioners' },
  { label: t('members.relationships.rankModes.mentioned'), value: 'mentioned' },
])

const activeMentionRankData = computed(() =>
  activeMentionRank.value === 'mentioners' ? mentionerRankData.value : mentionedRankData.value
)

const activeMentionRankDescription = computed(() =>
  activeMentionRank.value === 'mentioners'
    ? t('members.relationships.topMentionersDescription')
    : t('members.relationships.topMentionedDescription')
)

watch(
  () => [props.sessionId, props.timeFilter],
  () => {
    loadMentionAnalysis()
  },
  { immediate: true, deep: true }
)
</script>

<template>
  <div class="main-content mx-auto max-w-3xl p-6">
    <LoadingState v-if="isLoadingMention" :text="t('members.relationships.loading')" />

    <RankListPro
      v-else-if="mentionAnalysis && mentionAnalysis.totalMentions > 0 && activeMentionRankData.length > 0"
      :members="activeMentionRankData"
      :title="t('members.relationships.rankingTitle')"
      :description="activeMentionRankDescription"
      :unit="t('members.relationships.times')"
    >
      <template #headerRight>
        <Tabs v-model="activeMentionRank" :items="mentionRankTabs" size="sm" />
      </template>
    </RankListPro>

    <SectionCard v-else :title="t('members.relationships.emptyTitle')">
      <EmptyState :text="t('members.relationships.empty')" />
    </SectionCard>
  </div>
</template>
