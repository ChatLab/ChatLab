<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DragonKingAnalysis, CheckInAnalysis } from '@openchatlab/core'
import type { MemberActivity } from '@/types/analysis'
import { EChartRank } from '@/components/charts'
import type { RankItem } from '@/components/charts'
import { SectionCard, LoadingState, Tabs, TopNSelect } from '@/components/UI'
import { useDataService } from '@/services/data/service'
import type { TimeFilter } from '@openchatlab/shared-types'

const props = withDefaults(
  defineProps<{
    sessionId: string
    memberActivity: MemberActivity[]
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

const dragonKingAnalysis = ref<DragonKingAnalysis | null>(null)
const checkInAnalysis = ref<CheckInAnalysis | null>(null)
const isLoading = ref(false)
const activeTab = ref<'activity' | 'dragon' | 'loyalty'>('activity') // 默认发言数量
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
    const data = useDataService()
    const [dragonKing, checkIn] = await Promise.all([
      data.getDragonKingAnalysis(props.sessionId, props.timeFilter),
      data.getCheckInAnalysis(props.sessionId, props.timeFilter),
    ])
    dragonKingAnalysis.value = dragonKing
    checkInAnalysis.value = checkIn
  } catch (error) {
    console.error('加载活跃数据失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 发言数量数据
const memberRankData = computed<RankItem[]>(() => {
  return props.memberActivity.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: m.messageCount,
    percentage: m.percentage,
  }))
})

// 龙王榜数据
const dragonKingRankData = computed<RankItem[]>(() => {
  if (!dragonKingAnalysis.value) return []
  return dragonKingAnalysis.value.rank.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: m.count,
    percentage: m.percentage,
  }))
})

// 忠臣榜（累计发言）数据
const loyaltyRankData = computed<RankItem[]>(() => {
  if (!checkInAnalysis.value) return []
  return checkInAnalysis.value.loyaltyRank.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: m.totalDays,
    percentage: m.percentage,
  }))
})

const currentRankData = computed(() => {
  switch (activeTab.value) {
    case 'activity':
      return memberRankData.value
    case 'dragon':
      return dragonKingRankData.value
    case 'loyalty':
      return loyaltyRankData.value
    default:
      return memberRankData.value
  }
})

const rankUnit = computed(() => {
  switch (activeTab.value) {
    case 'activity':
      return '条'
    case 'dragon':
    case 'loyalty':
      return '天'
    default:
      return '条'
  }
})

const cardTitle = computed(() => {
  switch (activeTab.value) {
    case 'activity':
      return '🏆 活跃榜 - 发言数量'
    case 'dragon':
      return '🏆 活跃榜 - 龙王'
    case 'loyalty':
      return '🏆 活跃榜 - 累计发言'
    default:
      return '🏆 活跃榜'
  }
})

const cardDescription = computed(() => {
  switch (activeTab.value) {
    case 'activity':
      return '按消息发送数量排名'
    case 'dragon': {
      const totalDays = dragonKingAnalysis.value?.totalDays ?? 0
      return `每天发言最多的人+1（共 ${totalDays} 天）`
    }
    case 'loyalty': {
      const totalDays = checkInAnalysis.value?.totalDays ?? 0
      return `累计发言天数排名（共 ${totalDays} 天）`
    }
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
  <SectionCard :title="cardTitle" :description="cardDescription">
    <template #headerRight>
      <div class="flex items-center gap-3">
        <TopNSelect v-if="showTopNSelect" v-model="topN" />
        <Tabs
          v-model="activeTab"
          :items="[
            { label: '发言数量', value: 'activity' },
            { label: '龙王', value: 'dragon' },
            { label: '累计发言', value: 'loyalty' },
          ]"
          size="sm"
        />
      </div>
    </template>

    <LoadingState v-if="isLoading && (activeTab === 'dragon' || activeTab === 'loyalty')" text="正在加载数据..." />

    <template v-else>
      <EChartRank
        v-if="currentRankData.length > 0"
        :members="currentRankData"
        :title="cardTitle"
        :unit="rankUnit"
        :top-n="topN"
        bare
      />
      <div v-else class="py-8 text-center text-sm text-gray-400">暂无数据</div>
    </template>
  </SectionCard>
</template>
