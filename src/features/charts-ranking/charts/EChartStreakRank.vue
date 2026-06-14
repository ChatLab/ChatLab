<script setup lang="ts">
/**
 * ECharts 火花榜（连续天数排名）组件
 * 使用横向柱状图展示连续天数数据，当前仍在连续的成员用特殊颜色标记
 */
import { computed } from 'vue'
import type { EChartsOption, BarSeriesOption } from 'echarts'
import { EChart } from '@/components/charts'
import { SectionCard, ScrollableChart } from '@/components/UI'
import { useRankingLayout } from '@/utils/rankingChartLayout'

interface StreakItem {
  memberId: number
  name: string
  maxStreak: number
  maxStreakStart: string
  maxStreakEnd: string
  currentStreak: number
}

interface Props {
  /** 排名数据 */
  items: StreakItem[]
  /** 标题 */
  title: string
  /** 描述（可选） */
  description?: string
  /** 最大显示数量，默认 10 */
  topN?: number
  /** 显示模式：'max' 最长连续, 'current' 当前连续 */
  mode?: 'max' | 'current'
  /** 容器最大高度（vh 单位），默认 60vh，超出则滚动 */
  maxHeightVh?: number
  /** 是否为裸图表模式（不包含 SectionCard 容器） */
  bare?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  topN: 10,
  mode: 'max',
  maxHeightVh: 60,
  bare: false,
})
const rankingLayout = useRankingLayout()

// 限制显示数量，根据模式过滤和排序
const displayData = computed(() => {
  if (props.mode === 'current') {
    // 当前连续模式：只显示 currentStreak > 0 的成员，按 currentStreak 排序
    return props.items
      .filter((item) => item.currentStreak > 0)
      .sort((a, b) => b.currentStreak - a.currentStreak)
      .slice(0, props.topN)
  }
  // 最长连续模式：显示全部，按 maxStreak 排序
  return props.items.slice(0, props.topN)
})

// 计算图表高度
const chartHeight = computed(() => {
  const dataHeight = displayData.value.length * 36
  return Math.max(dataHeight + 30, 180)
})

// 正常颜色（粉色渐变）
const normalColor = {
  type: 'linear' as const,
  x: 0,
  y: 0,
  x2: 1,
  y2: 0,
  colorStops: [
    { offset: 0, color: '#ee4567' },
    { offset: 1, color: '#f7758c' },
  ],
}

// 当前仍在连续的颜色（橙色渐变 - 火焰色）
const activeColor = {
  type: 'linear' as const,
  x: 0,
  y: 0,
  x2: 1,
  y2: 0,
  colorStops: [
    { offset: 0, color: '#f97316' },
    { offset: 1, color: '#fb923c' },
  ],
}

// 截断名字
function truncateName(name: string, maxLength = 8): string {
  if (name.length <= maxLength) return name
  return name.slice(0, maxLength) + '…'
}

// 格式化日期区间
function formatDateRange(start: string, end: string): string {
  return `${start} ~ ${end}`
}

// 获取当前模式下的数值
function getValue(item: StreakItem): number {
  return props.mode === 'current' ? item.currentStreak : item.maxStreak
}

// 生成 ECharts 配置
const option = computed<EChartsOption>(() => {
  const reversedData = [...displayData.value].reverse()
  const names = reversedData.map((item) => truncateName(item.name, rankingLayout.value.labelMaxLength))
  const values = reversedData.map((item) => getValue(item))
  const maxValue = Math.max(...values, 1)

  // 为每个柱子配置颜色和样式
  const dataWithStyle = reversedData.map((item) => ({
    value: getValue(item),
    itemStyle: {
      // 当前连续模式全部用橙色，最长连续模式根据是否仍在连续
      color: props.mode === 'current' || item.currentStreak > 0 ? activeColor : normalColor,
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
        if (props.mode === 'current') {
          // 当前连续模式
          return `
            <div style="padding: 4px 8px;">
              <div style="font-weight: bold; margin-bottom: 6px;">${item.name}</div>
              <div style="color: #fb923c;">🔥 当前连续 <b>${item.currentStreak}</b> 天</div>
              <div style="margin-top: 4px; font-size: 12px; color: #9ca3af;">最长记录: ${item.maxStreak} 天</div>
            </div>
          `
        }
        // 最长连续模式
        let html = `
          <div style="padding: 4px 8px;">
            <div style="font-weight: bold; margin-bottom: 6px;">${item.name}</div>
            <div style="margin-bottom: 4px;">🔥 最长连续: <b>${item.maxStreak}</b> 天</div>
            <div style="font-size: 12px; color: #9ca3af;">${formatDateRange(item.maxStreakStart, item.maxStreakEnd)}</div>
        `
        if (item.currentStreak > 0) {
          html += `<div style="margin-top: 6px; color: #fb923c;">🔥 当前连续 ${item.currentStreak} 天</div>`
        }
        html += '</div>'
        return html
      },
    },
    grid: {
      left: rankingLayout.value.gridLeft,
      right: 70,
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
            const value = getValue(item)
            // 当前连续模式或最长连续模式中仍在连续的，显示火焰图标
            const suffix = props.mode === 'current' || item.currentStreak > 0 ? ' 🔥' : ''
            return `${value} 天${suffix}`
          },
          fontSize: 11,
          fontWeight: 500,
          color: '#6b7280',
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 6,
            shadowColor: 'rgba(249, 115, 22, 0.3)',
          },
        },
      } as BarSeriesOption,
    ],
  }
})
</script>

<template>
  <!-- 裸图表模式 -->
  <div v-if="bare">
    <ScrollableChart :content-height="chartHeight" :max-height-vh="maxHeightVh">
      <EChart :option="option" :height="chartHeight" />
    </ScrollableChart>
    <!-- 图例（仅在最长连续模式显示） -->
    <div
      v-if="mode === 'max'"
      class="flex items-center justify-center gap-6 border-t border-gray-100 px-5 py-3 dark:border-gray-800"
    >
      <div class="flex items-center gap-1.5">
        <div class="h-3 w-6 rounded bg-linear-to-r from-orange-500 to-orange-400" />
        <span class="text-xs text-gray-500">当前连续中 🔥</span>
      </div>
      <div class="flex items-center gap-1.5">
        <div class="h-3 w-6 rounded bg-linear-to-r from-pink-500 to-pink-400" />
        <span class="text-xs text-gray-500">已中断</span>
      </div>
    </div>
  </div>
  <!-- 完整模式 -->
  <SectionCard v-else :title="title" :description="description" scrollable :max-height-vh="maxHeightVh">
    <div class="px-3 py-2">
      <EChart :option="option" :height="chartHeight" />
    </div>
    <!-- 图例（仅在最长连续模式显示） -->
    <template v-if="mode === 'max'" #footer>
      <div class="flex items-center justify-center gap-6 border-t border-gray-100 px-5 py-3 dark:border-gray-800">
        <div class="flex items-center gap-1.5">
          <div class="h-3 w-6 rounded bg-linear-to-r from-orange-500 to-orange-400" />
          <span class="text-xs text-gray-500">当前连续中 🔥</span>
        </div>
        <div class="flex items-center gap-1.5">
          <div class="h-3 w-6 rounded bg-linear-to-r from-pink-500 to-pink-400" />
          <span class="text-xs text-gray-500">已中断</span>
        </div>
      </div>
    </template>
  </SectionCard>
</template>
