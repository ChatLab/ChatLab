<script setup lang="ts">
/**
 * ECharts 潜水榜组件
 * 使用横向柱状图展示距今天数
 */
import { computed, ref, watch } from 'vue'
import type { EChartsOption, BarSeriesOption } from 'echarts'
import { EChart } from '@/components/charts'
import { SectionCard, Tabs, TopNSelect } from '@/components/UI'
import { formatFullDateTime } from '@/utils/dateFormat'
import { useRankingLayout } from '@/utils/rankingChartLayout'

interface DivingItem {
  memberId: number
  name: string
  lastMessageTs: number // 时间戳（秒）
  daysSinceLastMessage: number
}

interface Props {
  /** 排名数据 */
  items: DivingItem[]
  /** 是否显示 TopN 选择器 */
  showTopNSelect?: boolean
  /** 容器最大高度（vh 单位），默认 60vh，超出则滚动 */
  maxHeightVh?: number
  /** 全局 TopN 控制（变化时强制同步） */
  globalTopN?: number
}

const props = withDefaults(defineProps<Props>(), {
  showTopNSelect: true,
  maxHeightVh: 60,
})
const rankingLayout = useRankingLayout()

const sortOrder = ref<'desc' | 'asc'>('desc') // 默认倒序（潜水最久的在前）
const topN = ref(props.globalTopN ?? 10) // 内部控制的 topN

// 监听全局 TopN 变化，强制同步
watch(
  () => props.globalTopN,
  (newVal) => {
    if (newVal !== undefined) {
      topN.value = newVal
    }
  }
)

// 排序并限制显示数量
const displayData = computed(() => {
  const sorted = [...props.items].sort((a, b) => {
    return sortOrder.value === 'desc'
      ? b.daysSinceLastMessage - a.daysSinceLastMessage
      : a.daysSinceLastMessage - b.daysSinceLastMessage
  })
  return sorted.slice(0, topN.value)
})

// 动态标题
const dynamicTitle = computed(() => {
  return sortOrder.value === 'desc' ? '🤿 潜水榜 - 潜水最久' : '🤿 潜水榜 - 最近冒泡'
})

// 动态描述
const dynamicDescription = computed(() => {
  return sortOrder.value === 'desc' ? '距离上次发言时间最久的成员' : '最近发言过的成员'
})

// 计算图表高度
const chartHeight = computed(() => {
  const dataHeight = displayData.value.length * 36
  return Math.max(dataHeight + 30, 180)
})

// 统一的柱状图颜色
const barColor = {
  type: 'linear' as const,
  x: 0,
  y: 0,
  x2: 1,
  y2: 0,
  colorStops: [
    { offset: 0, color: '#06b6d4' }, // cyan-500
    { offset: 1, color: '#22d3ee' }, // cyan-400
  ],
}

// 截断名字
function truncateName(name: string, maxLength = 8): string {
  if (name.length <= maxLength) return name
  return name.slice(0, maxLength) + '…'
}

// 格式化天数显示
function formatDays(days: number): string {
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  return `${days} 天前`
}

// 生成 ECharts 配置
const option = computed<EChartsOption>(() => {
  if (displayData.value.length === 0) return {}

  const reversedData = [...displayData.value].reverse()
  const names = reversedData.map((item) => truncateName(item.name, rankingLayout.value.labelMaxLength))
  const maxDays = Math.max(...displayData.value.map((item) => item.daysSinceLastMessage), 1)

  const dataWithStyle = reversedData.map((item) => ({
    value: item.daysSinceLastMessage,
    itemStyle: {
      color: barColor,
      borderRadius: [0, 4, 4, 0],
    },
  }))

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow',
      },
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: 'transparent',
      textStyle: {
        color: '#fff',
      },
      formatter: (params: any) => {
        const data = params[0]
        if (!data) return ''
        const originalIndex = displayData.value.length - 1 - data.dataIndex
        const item = displayData.value[originalIndex]
        return `
          <div style="padding: 4px 8px;">
            <div style="font-weight: bold; margin-bottom: 6px;">${item.name}</div>
            <div style="margin-bottom: 4px;">🤿 ${formatDays(item.daysSinceLastMessage)}</div>
            <div style="font-size: 12px; color: #9ca3af;">最后发言: ${formatFullDateTime(item.lastMessageTs)}</div>
          </div>
        `
      },
    },
    grid: {
      left: rankingLayout.value.gridLeft,
      right: 100,
      top: 15,
      bottom: 15,
      containLabel: false,
    },
    xAxis: {
      type: 'value',
      max: maxDays * 1.15,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'category',
      data: names,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        fontSize: 12,
        color: '#4b5563',
        margin: 12,
        formatter: (value: string, index: number) => {
          const originalIndex = displayData.value.length - 1 - index
          const rank = originalIndex + 1
          const prefix = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`
          return `${prefix} ${value}`
        },
      },
    },
    series: [
      {
        type: 'bar',
        data: dataWithStyle,
        barWidth: 18,
        barCategoryGap: '30%',
        label: {
          show: true,
          position: 'right',
          distance: 8,
          formatter: (params: any) => {
            const originalIndex = displayData.value.length - 1 - params.dataIndex
            const item = displayData.value[originalIndex]
            return formatDays(item.daysSinceLastMessage)
          },
          fontSize: 11,
          fontWeight: 500,
          color: '#6b7280',
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 6,
            shadowColor: 'rgba(0, 0, 0, 0.2)',
          },
        },
      } as BarSeriesOption,
    ],
  }
})
</script>

<template>
  <SectionCard :title="dynamicTitle" :description="dynamicDescription" scrollable :max-height-vh="maxHeightVh">
    <template #headerRight>
      <div class="flex items-center gap-3">
        <TopNSelect v-if="showTopNSelect" v-model="topN" />
        <Tabs
          v-model="sortOrder"
          :items="[
            { label: '潜水最久', value: 'desc' },
            { label: '最近冒泡', value: 'asc' },
          ]"
          size="sm"
        />
      </div>
    </template>
    <div class="px-3 py-2">
      <EChart :option="option" :height="chartHeight" />
    </div>
  </SectionCard>
</template>
