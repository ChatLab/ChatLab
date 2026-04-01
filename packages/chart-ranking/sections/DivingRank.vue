<script setup lang="ts">
import { ref, watch } from 'vue'
import type { DivingAnalysis } from '../types'
import { EChartDivingRank } from '../charts'
import { LoadingState } from '@/components/UI'
import { queryDivingAnalysis } from '../queries'

interface TimeFilter {
  startTs?: number
  endTs?: number
}

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
    analysis.value = await queryDivingAnalysis(props.sessionId, props.timeFilter)
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
  <LoadingState v-if="isLoading" text="正在统计潜水数据..." />
  <EChartDivingRank
    v-else-if="analysis && analysis.rank.length > 0"
    :items="analysis.rank"
    :global-top-n="globalTopN"
  />
</template>
