<script setup lang="ts">
/**
 * ECharts 饼图/环形图组件
 */
import { computed } from 'vue'
import type { EChartsOption } from 'echarts'
import EChart from './EChart.vue'

export interface EChartPieData {
  labels: string[]
  values: number[]
}

interface Props {
  data: EChartPieData
  height?: number
  /** 是否为环形图 */
  doughnut?: boolean
  /** 内圈半径（环形图时生效） */
  innerRadius?: string
  /** 是否显示图例 */
  showLegend?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  height: 280,
  doughnut: true,
  innerRadius: '50%',
  showLegend: true,
})

// 颜色方案
const colors = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f43f5e', // rose
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
]

const option = computed<EChartsOption>(() => {
  const seriesData = props.data.labels.map((label, index) => ({
    name: label,
    value: props.data.values[index],
  }))

  return {
    color: colors,
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} ({d}%)',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: 'transparent',
      textStyle: {
        color: '#fff',
      },
    },
    legend: props.showLegend
      ? {
          orient: 'vertical',
          right: 10,
          top: 'center',
          textStyle: {
            fontSize: 12,
          },
        }
      : undefined,
    series: [
      {
        type: 'pie',
        radius: props.doughnut ? [props.innerRadius, '70%'] : '70%',
        center: props.showLegend ? ['35%', '50%'] : ['50%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 4,
          borderColor: '#fff',
          borderWidth: 2,
        },
        label: {
          show: false,
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 14,
            fontWeight: 'bold',
          },
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
        data: seriesData,
      },
    ],
  }
})
</script>

<template>
  <EChart :option="option" :height="height" />
</template>
