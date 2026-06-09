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
  mode?: 'compact' | 'expanded'
  /** 是否为环形图 */
  doughnut?: boolean
  /** 内圈半径（环形图时生效） */
  innerRadius?: string
  /** 是否显示图例 */
  showLegend?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  height: 280,
  mode: 'expanded',
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
  const itemCount = props.data.labels.length
  const isCompact = props.mode === 'compact'
  const isDense = itemCount > (isCompact ? 8 : 14)
  const useScrollableLegend = itemCount > (isCompact ? 6 : 12)
  const legendPlacement = isCompact
    ? {
        type: useScrollableLegend ? 'scroll' : 'plain',
        orient: 'horizontal' as const,
        left: 8,
        right: 8,
        bottom: 0,
        height: 28,
        textStyle: {
          fontSize: 11,
          overflow: 'truncate' as const,
          width: 72,
        },
      }
    : {
        type: useScrollableLegend ? 'scroll' : 'plain',
        orient: 'vertical' as const,
        right: 10,
        top: 24,
        bottom: 24,
        textStyle: {
          fontSize: 12,
          overflow: 'truncate' as const,
          width: 120,
        },
      }
  const showOuterLabel = !isCompact && !isDense
  const effectiveShowLegend = props.showLegend && !showOuterLabel

  return {
    color: colors,
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} ({d}%)',
      confine: true,
      extraCssText: 'max-width: min(360px, 70vw); white-space: normal; word-break: break-word;',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: 'transparent',
      textStyle: {
        color: '#fff',
      },
    },
    legend: effectiveShowLegend ? legendPlacement : undefined,
    series: [
      {
        type: 'pie',
        radius: props.doughnut ? [props.innerRadius, isCompact ? '58%' : '68%'] : isCompact ? '58%' : '68%',
        center: effectiveShowLegend
          ? isCompact
            ? ['50%', '42%']
            : ['38%', '50%']
          : ['50%', isCompact ? '46%' : '50%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 4,
          borderColor: '#fff',
          borderWidth: 2,
        },
        label: {
          show: showOuterLabel,
          formatter: '{b}',
          overflow: 'truncate',
          width: 110,
          alignTo: 'edge',
          edgeDistance: 12,
        },
        emphasis: {
          label: {
            show: showOuterLabel,
            fontSize: 14,
            fontWeight: 'bold',
            overflow: 'truncate',
            width: 140,
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
