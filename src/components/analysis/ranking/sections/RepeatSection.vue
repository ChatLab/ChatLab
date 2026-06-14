<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { RepeatAnalysis } from '@openchatlab/core'
import { EChartRank, EChartBar } from '@/components/charts'
import type { RankItem, EChartBarData } from '@/components/charts'
import { SectionCard, EmptyState, LoadingState, Tabs, TopNSelect } from '@/components/UI'
import { EChartTimeRank } from '../charts'
import { useDataService } from '@/services/data/service'
import type { TimeFilter } from '@openchatlab/shared-types'

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

const analysis = ref<RepeatAnalysis | null>(null)
const isLoading = ref(false)
const roleTab = ref<'originator' | 'initiator' | 'breaker'>('originator') // 角色 Tab
const statsTab = ref<'fastest' | 'distribution'>('fastest') // 统计 Tab
const roleTopN = ref(props.globalTopN ?? 10) // 复读榜 TopN
const statsTopN = ref(props.globalTopN ?? 10) // 复读统计 TopN

// 监听全局 TopN 变化，强制同步所有内部 TopN
watch(
  () => props.globalTopN,
  (newVal) => {
    if (newVal !== undefined) {
      roleTopN.value = newVal
      statsTopN.value = newVal
    }
  }
)

async function loadData() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    analysis.value = await useDataService().getRepeatAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('加载复读分析失败:', error)
  } finally {
    isLoading.value = false
  }
}

const originatorRankData = computed<RankItem[]>(() => {
  if (!analysis.value) return []
  return analysis.value.originators.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: m.count,
    percentage: m.percentage,
  }))
})

const initiatorRankData = computed<RankItem[]>(() => {
  if (!analysis.value) return []
  return analysis.value.initiators.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: m.count,
    percentage: m.percentage,
  }))
})

const breakerRankData = computed<RankItem[]>(() => {
  if (!analysis.value) return []
  return analysis.value.breakers.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: m.count,
    percentage: m.percentage,
  }))
})

// 根据当前 Tab 获取数据
const currentRankData = computed<RankItem[]>(() => {
  switch (roleTab.value) {
    case 'originator':
      return originatorRankData.value
    case 'initiator':
      return initiatorRankData.value
    case 'breaker':
      return breakerRankData.value
    default:
      return originatorRankData.value
  }
})

// 卡片标题
const cardTitle = computed(() => {
  switch (roleTab.value) {
    case 'originator':
      return '🔁 复读榜 - 被复读'
    case 'initiator':
      return '🔁 复读榜 - 挑起'
    case 'breaker':
      return '🔁 复读榜 - 打断'
    default:
      return '🔁 复读榜'
  }
})

// 卡片描述
const cardDescription = computed(() => {
  switch (roleTab.value) {
    case 'originator':
      return '发出的消息被别人复读的次数'
    case 'initiator':
      return '第二个发送相同消息、带起节奏的人'
    case 'breaker':
      return '终结复读链的人'
    default:
      return ''
  }
})

const chainLengthChartData = computed<EChartBarData>(() => {
  if (!analysis.value) return { labels: [], values: [] }
  const distribution = analysis.value.chainLengthDistribution
  return {
    labels: distribution.map((d) => `${d.length}人`),
    values: distribution.map((d) => d.count),
  }
})

// 统计卡片标题
const statsTitle = computed(() => {
  return statsTab.value === 'fastest' ? '📊 复读统计 - 最快反应' : '📊 复读统计 - 链长分布'
})

// 统计卡片描述
const statsDescription = computed(() => {
  if (statsTab.value === 'fastest') {
    return '平均复读反应时间（至少参与5次复读）'
  }
  const total = analysis.value?.totalRepeatChains ?? 0
  const avg = analysis.value?.avgChainLength ?? 0
  return `共 ${total} 次复读，平均 ${avg} 人参与`
})

watch(
  () => [props.sessionId, props.timeFilter],
  () => loadData(),
  { immediate: true, deep: true }
)
</script>

<template>
  <div class="space-y-6">
    <LoadingState v-if="isLoading" text="正在分析复读数据..." />

    <template v-else-if="analysis && analysis.totalRepeatChains > 0">
      <!-- 复读榜主卡片 -->
      <SectionCard :title="cardTitle" :description="cardDescription">
        <template #headerRight>
          <div class="flex items-center gap-3">
            <TopNSelect v-if="showTopNSelect" v-model="roleTopN" />
            <Tabs
              v-model="roleTab"
              :items="[
                { label: '被复读', value: 'originator' },
                { label: '挑起', value: 'initiator' },
                { label: '打断', value: 'breaker' },
              ]"
              size="sm"
            />
          </div>
        </template>

        <EChartRank
          v-if="currentRankData.length > 0"
          :members="currentRankData"
          :title="cardTitle"
          unit="次"
          :top-n="roleTopN"
          bare
        />
        <EmptyState v-else text="暂无数据" />
      </SectionCard>

      <!-- 复读统计（最快反应 + 链长分布） -->
      <SectionCard :title="statsTitle" :description="statsDescription">
        <template #headerRight>
          <div class="flex items-center gap-3">
            <TopNSelect v-if="showTopNSelect && statsTab === 'fastest'" v-model="statsTopN" />
            <Tabs
              v-model="statsTab"
              :items="[
                { label: '最快反应', value: 'fastest' },
                { label: '链长分布', value: 'distribution' },
              ]"
              size="sm"
            />
          </div>
        </template>

        <!-- 最快反应 -->
        <template v-if="statsTab === 'fastest'">
          <EChartTimeRank
            v-if="analysis.fastestRepeaters && analysis.fastestRepeaters.length > 0"
            :items="analysis.fastestRepeaters"
            :top-n="statsTopN"
            title=""
            bare
          />
          <EmptyState v-else text="暂无最快复读数据" />
        </template>

        <!-- 链长分布 -->
        <template v-else>
          <div class="px-3 py-2">
            <EChartBar v-if="chainLengthChartData.labels.length > 0" :data="chainLengthChartData" :height="200" />
            <EmptyState v-else text="暂无分布数据" />
          </div>
        </template>
      </SectionCard>
    </template>

    <SectionCard v-else title="🔁 复读榜">
      <EmptyState text="该群组暂无复读记录" />
    </SectionCard>
  </div>
</template>
