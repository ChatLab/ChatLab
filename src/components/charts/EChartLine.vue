<script setup lang="ts">
/**
 * ECharts 折线图组件
 */
import { computed } from 'vue'
import type { EChartsOption } from 'echarts'
import EChart from './EChart.vue'

export interface EChartLineData {
  labels: string[]
  values: number[]
}

interface Props {
  data: EChartLineData
  height?: number
  /** 是否显示面积 */
  showArea?: boolean
  /** 是否平滑曲线 */
  smooth?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  height: 288,
  showArea: true,
  smooth: true,
})

const option = computed<EChartsOption>(() => {
  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: 'transparent',
      textStyle: {
        color: '#fff',
      },
    },
    grid: {
      left: 50,
      right: 20,
      top: 20,
      bottom: 30,
    },
    xAxis: {
      type: 'category',
      data: props.data.labels,
      boundaryGap: false,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        fontSize: 11,
        color: '#6b7280',
        // 自动间隔显示标签
        interval: 'auto',
      },
    },
    yAxis: {
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
        type: 'line',
        data: props.data.values,
        smooth: props.smooth,
        symbol: 'circle',
        symbolSize: 4,
        showSymbol: false,
        lineStyle: {
          width: 2,
          color: '#ee4567', // 项目主题 pink-500
        },
        itemStyle: {
          color: '#ee4567',
        },
        areaStyle: props.showArea
          ? {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: 'rgba(238, 69, 103, 0.3)' }, // 项目主题粉色
                  { offset: 1, color: 'rgba(238, 69, 103, 0.05)' },
                ],
              },
            }
          : undefined,
        emphasis: {
          focus: 'series',
          itemStyle: {
            color: '#ee4567',
            borderColor: '#fff',
            borderWidth: 2,
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
