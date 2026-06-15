<script setup lang="ts">
/**
 * ECharts 史诗级斗图榜组件
 * 使用横向柱状图展示斗图战役，按图片数量排名
 */
import { computed } from 'vue'
import type { EChartsOption, BarSeriesOption } from 'echarts'
import { EChart } from '@/components/charts'
import { SectionCard, ScrollableChart } from '@/components/UI'
import { formatDate } from '@/utils/dateFormat'

interface BattleParticipant {
  memberId: number
  name: string
  imageCount: number
}

interface BattleRecord {
  startTime: number
  endTime: number
  totalImages: number
  participantCount: number
  participants: BattleParticipant[]
}

interface Props {
  /** 战役数据 */
  battles: BattleRecord[]
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

// 限制显示数量
const displayData = computed(() => {
  return props.battles.slice(0, props.topN)
})

// 计算图表高度（与 EChartRank 保持一致）
const chartHeight = computed(() => {
  const dataHeight = displayData.value.length * 36
  return Math.max(dataHeight + 30, 180)
})

// 柱状图颜色
const barColor = {
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

// 生成 Y 轴标签（仅人数）
function formatLabel(battle: BattleRecord): string {
  return `${battle.participantCount} 人参战`
}

// 生成 ECharts 配置
const option = computed<EChartsOption>(() => {
  const reversedData = [...displayData.value].reverse()
  const labels = reversedData.map((item) => formatLabel(item))
  const values = reversedData.map((item) => item.totalImages)
  const maxValue = Math.max(...values, 1)

  const dataWithStyle = reversedData.map((item) => ({
    value: item.totalImages,
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
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      borderColor: 'transparent',
      textStyle: {
        color: '#fff',
        fontSize: 12,
      },
      extraCssText: 'max-width: 300px;',
      formatter: (params: any) => {
        const data = params[0]
        if (!data) return ''
        const originalIndex = displayData.value.length - 1 - data.dataIndex
        const battle = displayData.value[originalIndex]

        // 构建参战人员列表（最多显示5人）
        const participantList = battle.participants
          .slice(0, 5)
          .map((p) => `<span style="color: #d1d5db;">${p.name}</span> <b>${p.imageCount}</b>张`)
          .join('、')
        const moreCount = battle.participants.length > 5 ? `、+${battle.participants.length - 5}` : ''

        return `
          <div style="padding: 6px 8px;">
            <div style="font-weight: bold; margin-bottom: 8px; font-size: 13px;">
              ⚔️ ${formatDate(battle.startTime)}
            </div>
            <div style="margin-bottom: 6px;">
              <span style="color: #9ca3af;">参战人数:</span> <b>${battle.participantCount}</b> 人
            </div>
            <div style="margin-bottom: 8px;">
              <span style="color: #9ca3af;">总图片数:</span> <b style="color: #f472b6;">${battle.totalImages}</b> 张
            </div>
            <div style="border-top: 1px solid #374151; padding-top: 6px; font-size: 11px;">
              ${participantList}${moreCount}
            </div>
          </div>
        `
      },
    },
    grid: {
      left: 95,
      right: 125,
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
      data: labels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        fontSize: 11,
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
            const battle = displayData.value[originalIndex]
            const date = formatDate(battle.startTime)
            return `${battle.totalImages} 张 (${date})`
          },
          fontSize: 11,
          fontWeight: 500,
          color: '#6b7280',
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 6,
            shadowColor: 'rgba(238, 69, 103, 0.3)',
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
