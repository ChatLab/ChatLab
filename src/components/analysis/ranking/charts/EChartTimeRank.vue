<script setup lang="ts">
/**
 * ECharts 最快复读选手组件
 * 使用横向柱状图展示反应时间，第一名最长，越慢越短
 */
import { computed } from 'vue'
import type { EChartsOption, BarSeriesOption } from 'echarts'
import { EChart } from '@/components/charts'
import { SectionCard, ScrollableChart } from '@/components/UI'
import { useRankingLayout } from '@/utils/rankingChartLayout'

interface TimeRankItem {
  memberId: number
  name: string
  count: number
  avgTimeDiff: number // 毫秒
}

interface Props {
  /** 排名数据 */
  items: TimeRankItem[]
  /** 标题 */
  title: string
  /** 描述（可选） */
  description?: string
  /** 最大显示数量，默认 10 */
  topN?: number
  /** 容器最大高度（vh 单位），默认 60vh，超出则滚动 */
  maxHeightVh?: number
  /** 是否为裸图表模式（不包含 SectionCard 容器） */
  bare?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  topN: 10,
  maxHeightVh: 60,
  bare: false,
})
const rankingLayout = useRankingLayout()

// 限制显示数量
const displayData = computed(() => {
  return props.items.slice(0, props.topN)
})

// 计算图表高度
const chartHeight = computed(() => {
  const dataHeight = displayData.value.length * 36
  return Math.max(dataHeight + 30, 180)
})

// 柱状图颜色（黄橙色 - 闪电快）
const barColor = {
  type: 'linear' as const,
  x: 0,
  y: 0,
  x2: 1,
  y2: 0,
  colorStops: [
    { offset: 0, color: '#f59e0b' },
    { offset: 1, color: '#fbbf24' },
  ],
}

// 截断名字
function truncateName(name: string, maxLength = 8): string {
  if (name.length <= maxLength) return name
  return name.slice(0, maxLength) + '…'
}

// 格式化时间
function formatTime(ms: number): string {
  return (ms / 1000).toFixed(2) + 's'
}

// 生成 ECharts 配置
const option = computed<EChartsOption>(() => {
  if (displayData.value.length === 0) return {}

  const reversedData = [...displayData.value].reverse()
  const names = reversedData.map((item) => truncateName(item.name, rankingLayout.value.labelMaxLength))

  // 计算相对值：第一名时间最短，进度条最长（100%）
  // 使用反比例：第一名时间 / 当前时间 * 100
  const fastestTime = displayData.value[0].avgTimeDiff

  const dataWithStyle = reversedData.map((item) => ({
    value: Math.round((fastestTime / item.avgTimeDiff) * 100),
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
            <div style="margin-bottom: 4px;">⚡️ 平均反应时间: <b>${formatTime(item.avgTimeDiff)}</b></div>
            <div style="font-size: 12px; color: #9ca3af;">参与复读 ${item.count} 次</div>
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
      max: 105,
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
            return `${formatTime(item.avgTimeDiff)} · ${item.count}次`
          },
          fontSize: 11,
          fontWeight: 500,
          color: '#6b7280',
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 6,
            shadowColor: 'rgba(245, 158, 11, 0.3)',
          },
        },
      } as BarSeriesOption,
    ],
  }
})
</script>

<template>
  <!-- 裸图表模式 -->
  <ScrollableChart v-if="bare" :content-height="chartHeight" :max-height-vh="maxHeightVh">
    <EChart :option="option" :height="chartHeight" />
  </ScrollableChart>
  <!-- 完整模式 -->
  <SectionCard v-else :title="title" :description="description" scrollable :max-height-vh="maxHeightVh">
    <div class="px-3 py-2">
      <EChart :option="option" :height="chartHeight" />
    </div>
  </SectionCard>
</template>
