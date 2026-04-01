<script setup lang="ts">
/**
 * ECharts 热力图组件
 * 用于展示二维数据的密度分布，如小时x星期的消息分布
 */
import { computed } from 'vue'
import type { EChartsOption } from 'echarts'
import EChart from './EChart.vue'

export interface EChartHeatmapData {
  /** X 轴标签 */
  xLabels: string[]
  /** Y 轴标签 */
  yLabels: string[]
  /** 数据：[x索引, y索引, 值] */
  data: Array<[number, number, number]>
}

interface Props {
  data: EChartHeatmapData
  height?: number
  /** 最小值颜色 */
  minColor?: string
  /** 最大值颜色 */
  maxColor?: string
}

const props = withDefaults(defineProps<Props>(), {
  height: 280,
  minColor: '#fee5e8', // 项目主题 pink-100
  maxColor: '#ee4567', // 项目主题 pink-500
})

// 计算数据的最大值
const maxValue = computed(() => {
  let max = 0
  for (const [, , value] of props.data.data) {
    if (value > max) max = value
  }
  return max || 1
})

const option = computed<EChartsOption>(() => {
  return {
    tooltip: {
      position: 'top',
      formatter: (params: any) => {
        const xLabel = props.data.xLabels[params.data[0]]
        const yLabel = props.data.yLabels[params.data[1]]
        const value = params.data[2]
        return `${yLabel} ${xLabel}<br/>消息数: <strong>${value}</strong>`
      },
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: 'transparent',
      textStyle: {
        color: '#fff',
      },
    },
    grid: {
      left: 60,
      right: 20,
      top: 20,
      bottom: 60,
    },
    xAxis: {
      type: 'category',
      data: props.data.xLabels,
      splitArea: {
        show: true,
      },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        fontSize: 11,
        color: '#6b7280',
        interval: 0,
      },
    },
    yAxis: {
      type: 'category',
      data: props.data.yLabels,
      splitArea: {
        show: true,
      },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        fontSize: 11,
        color: '#6b7280',
      },
    },
    visualMap: {
      min: 0,
      max: maxValue.value,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 10,
      itemHeight: 120,
      inRange: {
        color: [props.minColor, props.maxColor],
      },
      textStyle: {
        color: '#6b7280',
        fontSize: 11,
      },
    },
    series: [
      {
        type: 'heatmap',
        data: props.data.data,
        label: {
          show: false,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
  }
})
</script>

<template>
  <EChart :option="option" :height="height" />
</template>
