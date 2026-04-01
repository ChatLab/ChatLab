<script setup lang="ts">
/**
 * ECharts 排名图表组件
 * 使用横向柱状图展示排名数据，前三名显示奖牌 emoji
 */
import { computed } from 'vue'
import type { EChartsOption, BarSeriesOption } from 'echarts'
import EChart from './EChart.vue'
import type { RankItem } from './RankList.vue'
import { SectionCard, ScrollableChart } from '@/components/UI'

interface Props {
  /** 排名数据 */
  members: RankItem[]
  /** 标题 */
  title: string
  /** 描述（可选） */
  description?: string
  /** 最大显示数量，默认 10 */
  topN?: number
  /** 单位名称 */
  unit?: string
  /** 图表高度策略：'auto' 根据数据量计算，或固定像素值 */
  height?: 'auto' | number
  /** 容器最大高度（vh 单位），默认 60vh，超出则滚动 */
  maxHeightVh?: number
  /** 是否为裸图表模式（不包含 SectionCard 容器） */
  bare?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  topN: 10,
  unit: '条',
  height: 'auto',
  maxHeightVh: 60,
  bare: false,
})

// 限制显示数量
const displayData = computed(() => {
  return props.members.slice(0, props.topN)
})

// 计算图表高度
const chartHeight = computed(() => {
  if (props.height !== 'auto') {
    return props.height
  }
  // 每条数据 36px（更紧凑）
  const dataHeight = displayData.value.length * 36
  // 增加上下边距
  return Math.max(dataHeight + 30, 180)
})

// 统一使用项目主题粉色
const barColor = {
  type: 'linear' as const,
  x: 0,
  y: 0,
  x2: 1,
  y2: 0,
  colorStops: [
    { offset: 0, color: '#ee4567' }, // 项目主题 pink-500
    { offset: 1, color: '#f7758c' }, // 项目主题 pink-400
  ],
}

// 截断名字（最多8个字符）
function truncateName(name: string, maxLength = 8): string {
  if (name.length <= maxLength) return name
  return name.slice(0, maxLength) + '…'
}

// 生成 ECharts 配置
const option = computed<EChartsOption>(() => {
  // 数据需要反转，因为柱状图 Y 轴从下到上
  const reversedData = [...displayData.value].reverse()
  const names = reversedData.map((item) => truncateName(item.name))
  const values = reversedData.map((item) => item.value)
  const maxValue = Math.max(...values, 1)

  // 柱子数据（统一颜色）
  const dataWithStyle = reversedData.map((item) => ({
    value: item.value,
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
        const member = displayData.value[originalIndex]
        return `
          <div style="padding: 4px 8px;">
            <div style="font-weight: bold; margin-bottom: 4px;">${member.name}</div>
            <div>${member.value} ${props.unit} (${member.percentage}%)</div>
          </div>
        `
      },
    },
    grid: {
      left: 110,
      right: 70,
      top: 15,
      bottom: 15,
      containLabel: false,
    },
    xAxis: {
      type: 'value',
      max: maxValue * 1.1, // 留出标签空间
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
          // 前三名添加奖牌 emoji，其他用数字
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
            const member = displayData.value[originalIndex]
            return `${member.value} ${props.unit}`
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
  <!-- 裸图表模式：只显示图表 -->
  <ScrollableChart v-if="bare" :content-height="chartHeight" :max-height-vh="maxHeightVh">
    <EChart :option="option" :height="chartHeight" />
  </ScrollableChart>
  <!-- 完整模式：带 SectionCard 容器 -->
  <SectionCard v-else :title="title" :description="description" scrollable :max-height-vh="maxHeightVh">
    <div class="px-3 py-2">
      <EChart :option="option" :height="chartHeight" />
    </div>
  </SectionCard>
</template>
