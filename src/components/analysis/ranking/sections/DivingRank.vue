<script setup lang="ts">
import { ref, watch } from 'vue'
import type { DivingAnalysis } from '@openchatlab/core'
import { EChartDivingRank } from '../charts'
import { EmptyState, SectionCard } from '@/components/UI'
import { useDataService } from '@/services/data/service'
import type { TimeFilter } from '@openchatlab/shared-types'
import RankingLoadingBody from './RankingLoadingBody.vue'

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
  /** 全局 TopN 控制（变化时强制同步） */
  globalTopN?: number
}>()

const analysis = ref<DivingAnalysis | null>(null)
const isLoading = ref(false)

async function loadData() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    analysis.value = await useDataService().getDivingAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('加载潜水分析失败:', error)
  } finally {
    isLoading.value = false
  }
}

watch(
  () => [props.sessionId, props.timeFilter],
  () => loadData(),
  { immediate: true, deep: true }
)
</script>

<template>
  <SectionCard v-if="isLoading" title="🤿 潜水榜 - 潜水最久" description="距离上次发言时间最久的成员">
    <RankingLoadingBody />
  </SectionCard>
  <EChartDivingRank
    v-else-if="analysis && analysis.rank.length > 0"
    :items="analysis.rank"
    :global-top-n="globalTopN"
  />
  <SectionCard v-else title="🤿 潜水榜">
    <EmptyState text="暂无潜水数据" />
  </SectionCard>
</template>
