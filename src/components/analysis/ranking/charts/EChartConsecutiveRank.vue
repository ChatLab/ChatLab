<script setup lang="ts">
/**
 * ECharts 连续天数排名组件
 * 使用横向柱状图展示连续天数，当前仍在连续的用特殊颜色标记
 */
import { computed } from 'vue'
import type { EChartsOption, BarSeriesOption } from 'echarts'
import { EChart } from '@/components/charts'
import { SectionCard, ScrollableChart } from '@/components/UI'
import { useRankingLayout } from '@/utils/rankingChartLayout'

interface ConsecutiveItem {
  memberId: number
  name: string
  maxConsecutiveDays: number
  currentStreak: number
}

interface Props {
  /** 排名数据 */
  items: ConsecutiveItem[]
  /** 标题 */
  title: string
  /** 描述（可选） */
  description?: string
  /** 最大显示数量，默认 10 */
  topN?: number
  /** 容器最大高度（vh 单位），默认 60vh，超出则滚动 */
  maxHeightVh?: number
  /** 是否为裸图表模式 */
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
  return [...props.items].sort((a, b) => b.maxConsecutiveDays - a.maxConsecutiveDays).slice(0, props.topN)
})

// 计算图表高度
const chartHeight = computed(() => {
  const dataHeight = displayData.value.length * 36
  return Math.max(dataHeight + 30, 180)
})

// 柱状图颜色
const barColorActive = {
  type: 'linear' as const,
  x: 0,
  y: 0,
  x2: 1,
  y2: 0,
  colorStops: [
    { offset: 0, color: '#f97316' }, // orange-500
    { offset: 1, color: '#fb923c' }, // orange-400
  ],
}

const barColorInactive = {
  type: 'linear' as const,
  x: 0,
  y: 0,
  x2: 1,
  y2: 0,
  colorStops: [
    { offset: 0, color: '#ec4899' }, // pink-500
    { offset: 1, color: '#f472b6' }, // pink-400
  ],
}

// 截断名字
function truncateName(name: string, maxLength = 8): string {
  if (name.length <= maxLength) return name
  return name.slice(0, maxLength) + '…'
}

// 生成 ECharts 配置
const option = computed<EChartsOption>(() => {
  if (displayData.value.length === 0) return {}

  const reversedData = [...displayData.value].reverse()
  const names = reversedData.map((item) => truncateName(item.name, rankingLayout.value.labelMaxLength))
  const maxValue = Math.max(...displayData.value.map((item) => item.maxConsecutiveDays), 1)

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      borderColor: 'transparent',
      textStyle: { color: '#fff', fontSize: 12 },
      formatter: (params: any) => {
        if (!params || params.length === 0) return ''
        const dataIndex = params[0].dataIndex
        const originalIndex = displayData.value.length - 1 - dataIndex
        const item = displayData.value[originalIndex]
        let html = `
          <div style="padding: 6px 8px;">
            <div style="font-weight: bold; margin-bottom: 6px;">${item.name}</div>
            <div>最长连续: <b style="color: #f472b6;">${item.maxConsecutiveDays}</b> 天</div>
        `
        if (item.currentStreak > 0) {
          html += `<div style="color: #f97316;">🔥 当前连续 ${item.currentStreak} 天</div>`
        }
        html += '</div>'
        return html
      },
    },
    legend: {
      show: false,
    },
    grid: {
      left: rankingLayout.value.gridLeft,
      right: 75,
      top: 15,
      bottom: 15,
      containLabel: false,
    },
    xAxis: {
      type: 'value',
      max: maxValue * 1.15,
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
        name: '当前连续',
        type: 'bar',
        data: reversedData.map((item) => ({
          value: item.currentStreak > 0 ? item.maxConsecutiveDays : 0,
          itemStyle: { color: barColorActive, borderRadius: [0, 4, 4, 0] },
        })),
        barWidth: 18,
        barGap: '-100%',
        label: {
          show: true,
          position: 'right',
          distance: 8,
          formatter: (params: any) => {
            const originalIndex = displayData.value.length - 1 - params.dataIndex
            const item = displayData.value[originalIndex]
            if (item.currentStreak > 0) {
              return `${item.maxConsecutiveDays} 天`
            }
            return ''
          },
          fontSize: 11,
          fontWeight: 500,
          color: '#6b7280',
        },
      } as BarSeriesOption,
      {
        name: '已中断',
        type: 'bar',
        data: reversedData.map((item) => ({
          value: item.currentStreak === 0 ? item.maxConsecutiveDays : 0,
          itemStyle: { color: barColorInactive, borderRadius: [0, 4, 4, 0] },
        })),
        barWidth: 18,
        label: {
          show: true,
          position: 'right',
          distance: 8,
          formatter: (params: any) => {
            const originalIndex = displayData.value.length - 1 - params.dataIndex
            const item = displayData.value[originalIndex]
            if (item.currentStreak === 0) {
              return `${item.maxConsecutiveDays} 天`
            }
            return ''
          },
          fontSize: 11,
          fontWeight: 500,
          color: '#6b7280',
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
