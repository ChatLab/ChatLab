<script setup lang="ts">
/**
 * ECharts 柱状图组件
 */
import { computed } from 'vue'
import type { EChartsOption } from 'echarts'
import EChart from './EChart.vue'

export interface EChartBarData {
  labels: string[]
  values: number[]
}

interface Props {
  data: EChartBarData
  height?: number
  /** 是否为横向柱状图 */
  horizontal?: boolean
  /** 是否显示渐变色 */
  gradient?: boolean
  /** 柱子圆角 */
  borderRadius?: number
}

const props = withDefaults(defineProps<Props>(), {
  height: 200,
  horizontal: false,
  gradient: true,
  borderRadius: 4,
})

// 渐变色（使用项目主题粉色）
const gradientColor = {
  type: 'linear' as const,
  x: 0,
  y: 0,
  x2: 0,
  y2: 1,
  colorStops: [
    { offset: 0, color: '#ee4567' }, // 项目主题 pink-500
    { offset: 1, color: '#f7758c' }, // 项目主题 pink-400
  ],
}

const option = computed<EChartsOption>(() => {
  const isHorizontal = props.horizontal

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
    },
    grid: {
      left: isHorizontal ? 60 : 40,
      right: 20,
      top: 20,
      bottom: isHorizontal ? 20 : 30,
      containLabel: false,
    },
    xAxis: isHorizontal
      ? {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: {
            lineStyle: {
              type: 'dashed',
              color: '#e5e7eb',
            },
          },
        }
      : {
          type: 'category',
          data: props.data.labels,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            fontSize: 11,
            color: '#6b7280',
          },
        },
    yAxis: isHorizontal
      ? {
          type: 'category',
          data: props.data.labels,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            fontSize: 11,
            color: '#6b7280',
          },
        }
      : {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: {
            lineStyle: {
              type: 'dashed',
              color: '#e5e7eb',
            },
          },
        },
    series: [
      {
        type: 'bar',
        data: props.data.values,
        itemStyle: {
          color: props.gradient ? gradientColor : '#ee4567',
          borderRadius: props.borderRadius,
        },
        barMaxWidth: 40,
        emphasis: {
          itemStyle: {
            color: props.gradient
              ? {
                  ...gradientColor,
                  colorStops: [
                    { offset: 0, color: '#de335e' }, // 项目主题 pink-600
                    { offset: 1, color: '#ee4567' }, // 项目主题 pink-500
                  ],
                }
              : '#de335e',
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
