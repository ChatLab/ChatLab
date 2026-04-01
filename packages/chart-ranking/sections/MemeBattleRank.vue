<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MemeBattleAnalysis } from '../types'
import { EChartRank } from '@/components/charts'
import type { RankItem } from '@/components/charts'
import { LoadingState, Tabs, SectionCard, TopNSelect } from '@/components/UI'
import { EChartBattleRank } from '../charts'
import { queryMemeBattleAnalysis } from '../queries'

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = withDefaults(
  defineProps<{
    sessionId: string
    timeFilter?: TimeFilter
    /** 是否显示 TopN 选择器 */
    showTopNSelect?: boolean
    /** 全局 TopN 控制（变化时强制同步） */
    globalTopN?: number
  }>(),
  {
    showTopNSelect: true,
  }
)

const analysis = ref<MemeBattleAnalysis | null>(null)
const isLoading = ref(false)
const activeTab = ref<'count' | 'image' | 'battle'>('count') // 默认按场次
const topN = ref(props.globalTopN ?? 10)

// 监听全局 TopN 变化，强制同步
watch(
  () => props.globalTopN,
  (newVal) => {
    if (newVal !== undefined) {
      topN.value = newVal
    }
  }
)

async function loadData() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    analysis.value = await queryMemeBattleAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('加载斗图分析失败:', error)
  } finally {
    isLoading.value = false
  }
}

const rankDataByCount = computed<RankItem[]>(() => {
  if (!analysis.value) return []
  return analysis.value.rankByCount.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: m.count,
    percentage: m.percentage,
  }))
})

const rankDataByImageCount = computed<RankItem[]>(() => {
  if (!analysis.value) return []
  return analysis.value.rankByImageCount.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: m.count,
    percentage: m.percentage,
  }))
})

const currentRankData = computed(() => {
  return activeTab.value === 'count' ? rankDataByCount.value : rankDataByImageCount.value
})

const rankUnit = computed(() => {
  return activeTab.value === 'count' ? '场' : '张'
})

const cardTitle = computed(() => {
  switch (activeTab.value) {
    case 'battle':
      return '⚔️ 斗图榜 - 史诗级战役'
    case 'count':
      return '⚔️ 斗图榜 - 按场次'
    case 'image':
      return '⚔️ 斗图榜 - 按图量'
    default:
      return '⚔️ 斗图榜'
  }
})

const cardDescription = computed(() => {
  switch (activeTab.value) {
    case 'battle':
      return '记录最激烈的斗图大战'
    case 'count':
      return '参与斗图次数最多的人'
    case 'image':
      return '在斗图中发送图片最多的人'
    default:
      return ''
  }
})

watch(
  () => [props.sessionId, props.timeFilter],
  () => loadData(),
  { immediate: true, deep: true }
)
</script>

<template>
  <LoadingState v-if="isLoading" text="正在统计斗图数据..." />

  <SectionCard v-else-if="analysis" :title="cardTitle" :description="cardDescription">
    <template #headerRight>
      <div class="flex items-center gap-3">
        <TopNSelect v-if="showTopNSelect" v-model="topN" />
        <Tabs
          v-model="activeTab"
          :items="[
            { label: '按场次', value: 'count' },
            { label: '按图量', value: 'image' },
            { label: '史诗级战役', value: 'battle' },
          ]"
          size="sm"
        />
      </div>
    </template>

    <!-- 史诗级战役视图 -->
    <template v-if="activeTab === 'battle'">
      <EChartBattleRank
        v-if="analysis.topBattles.length > 0"
        :battles="analysis.topBattles"
        title=""
        :top-n="topN"
        bare
      />
      <div v-else class="py-8 text-center text-sm text-gray-400">暂无史诗级战役数据</div>
    </template>

    <!-- 按场次/按图量视图 -->
    <template v-else>
      <EChartRank
        v-if="currentRankData.length > 0"
        :members="currentRankData"
        :title="cardTitle"
        :unit="rankUnit"
        :top-n="topN"
        bare
      />
      <div v-else class="py-8 text-center text-sm text-gray-400">暂无斗图数据</div>
    </template>
  </SectionCard>
</template>
