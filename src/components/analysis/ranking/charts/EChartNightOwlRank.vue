<script setup lang="ts">
/**
 * ECharts 深夜发言排行组件
 * 使用堆叠横向柱状图展示各时段分布
 */
import { computed } from 'vue'
import type { EChartsOption, BarSeriesOption } from 'echarts'
import { EChart } from '@/components/charts'
import { SectionCard, ScrollableChart } from '@/components/UI'
import { useRankingLayout } from '@/utils/rankingChartLayout'

interface NightOwlItem {
  memberId: number
  name: string
  totalNightMessages: number
  title: string
  hourlyBreakdown: {
    h23: number
    h0: number
    h1: number
    h2: number
    h3to4: number
  }
  percentage: number
}

interface Props {
  /** 排名数据 */
  items: NightOwlItem[]
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
  return props.items.slice(0, props.topN)
})

// 计算图表高度
const chartHeight = computed(() => {
  const dataHeight = displayData.value.length * 36
  return Math.max(dataHeight + 50, 200)
})

// 各时段颜色
const colors = {
  h23: '#8b5cf6', // violet-500 (23点)
  h0: '#3b82f6', // blue-500 (0点)
  h1: '#06b6d4', // cyan-500 (1点)
  h2: '#f59e0b', // amber-500 (2点)
  h3to4: '#ef4444', // red-500 (3-4点)
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
  const maxValue = Math.max(...displayData.value.map((item) => item.totalNightMessages), 1)

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
        const b = item.hourlyBreakdown
        return `
          <div style="padding: 6px 8px;">
            <div style="font-weight: bold; margin-bottom: 6px;">${item.name}</div>
            <div style="margin-bottom: 4px;">
              称号: <b style="color: #f472b6;">${item.title}</b>
            </div>
            <div style="margin-bottom: 6px;">总发言: <b>${item.totalNightMessages}</b> 条</div>
            <div style="border-top: 1px solid #374151; padding-top: 6px;">
              <div><span style="color: ${colors.h23};">●</span> 23点: ${b.h23} 条</div>
              <div><span style="color: ${colors.h0};">●</span> 0点: ${b.h0} 条</div>
              <div><span style="color: ${colors.h1};">●</span> 1点: ${b.h1} 条</div>
              <div><span style="color: ${colors.h2};">●</span> 2点: ${b.h2} 条</div>
              <div><span style="color: ${colors.h3to4};">●</span> 3-4点: ${b.h3to4} 条</div>
            </div>
          </div>
        `
      },
    },
    legend: {
      show: true,
      bottom: 0,
      itemWidth: 12,
      itemHeight: 12,
      textStyle: { color: '#6b7280', fontSize: 10 },
    },
    grid: {
      left: rankingLayout.value.gridLeft,
      right: 70,
      top: 15,
      bottom: 35,
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
        name: '23点',
        type: 'bar',
        stack: 'total',
        data: reversedData.map((item) => item.hourlyBreakdown.h23),
        itemStyle: { color: colors.h23 },
        barWidth: 18,
      } as BarSeriesOption,
      {
        name: '0点',
        type: 'bar',
        stack: 'total',
        data: reversedData.map((item) => item.hourlyBreakdown.h0),
        itemStyle: { color: colors.h0 },
        barWidth: 18,
      } as BarSeriesOption,
      {
        name: '1点',
        type: 'bar',
        stack: 'total',
        data: reversedData.map((item) => item.hourlyBreakdown.h1),
        itemStyle: { color: colors.h1 },
        barWidth: 18,
      } as BarSeriesOption,
      {
        name: '2点',
        type: 'bar',
        stack: 'total',
        data: reversedData.map((item) => item.hourlyBreakdown.h2),
        itemStyle: { color: colors.h2 },
        barWidth: 18,
      } as BarSeriesOption,
      {
        name: '3-4点',
        type: 'bar',
        stack: 'total',
        data: reversedData.map((item) => item.hourlyBreakdown.h3to4),
        itemStyle: { color: colors.h3to4, borderRadius: [0, 4, 4, 0] },
        barWidth: 18,
        label: {
          show: true,
          position: 'right',
          distance: 8,
          formatter: (params: any) => {
            const originalIndex = displayData.value.length - 1 - params.dataIndex
            const item = displayData.value[originalIndex]
            return `${item.totalNightMessages} 条`
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
