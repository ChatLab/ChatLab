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
  series?: Array<{ name: string; values: number[] }>
}

interface Props {
  data: EChartLineData
  height?: number
  mode?: 'compact' | 'expanded'
  /** 是否显示面积 */
  showArea?: boolean
  /** 是否平滑曲线 */
  smooth?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  height: 288,
  mode: 'expanded',
  showArea: true,
  smooth: true,
})

const option = computed<EChartsOption>(() => {
  const hasSeries = !!props.data.series?.length
  const isCompact = props.mode === 'compact'
  const seriesCount = props.data.series?.length ?? 0
  const labelCount = props.data.labels.length
  const useScrollableLegend = seriesCount > (isCompact ? 3 : 8)
  const useDataZoom = !isCompact && labelCount > 30
  const series = hasSeries
    ? props.data.series!.map((item) => ({
        name: item.name,
        type: 'line' as const,
        data: item.values,
        smooth: props.smooth,
        symbol: 'circle',
        symbolSize: 4,
        showSymbol: !isCompact && labelCount <= 80,
        lineStyle: {
          width: 2,
        },
        areaStyle: props.showArea ? { opacity: 0.08 } : undefined,
        emphasis: {
          focus: 'series' as const,
        },
      }))
    : [
        {
          type: 'line' as const,
          data: props.data.values,
          smooth: props.smooth,
          symbol: 'circle',
          symbolSize: 4,
          showSymbol: !isCompact && labelCount <= 80,
          lineStyle: {
            width: 2,
            color: '#ee4567',
          },
          itemStyle: {
            color: '#ee4567',
          },
          areaStyle: props.showArea
            ? {
                color: {
                  type: 'linear' as const,
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: 'rgba(238, 69, 103, 0.3)' },
                    { offset: 1, color: 'rgba(238, 69, 103, 0.05)' },
                  ],
                },
              }
            : undefined,
          emphasis: {
            focus: 'series' as const,
            itemStyle: {
              color: '#ee4567',
              borderColor: '#fff',
              borderWidth: 2,
            },
          },
        },
      ]

  return {
    tooltip: {
      trigger: 'axis',
      confine: true,
      extraCssText: 'max-width: min(420px, 76vw); white-space: normal; word-break: break-word;',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: 'transparent',
      textStyle: {
        color: '#fff',
      },
    },
    grid: {
      left: 50,
      right: 20,
      top: hasSeries ? (isCompact ? 44 : 56) : 20,
      bottom: useDataZoom ? 66 : 34,
      outerBoundsMode: 'same',
    },
    legend: hasSeries
      ? {
          type: useScrollableLegend ? 'scroll' : 'plain',
          top: 0,
          left: 8,
          right: 8,
          height: 32,
          textStyle: { color: '#6b7280', fontSize: 11 },
        }
      : undefined,
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
        hideOverlap: true,
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
    dataZoom: useDataZoom
      ? [
          { type: 'inside', throttle: 50 },
          { type: 'slider', height: 18, bottom: 18, showDetail: false },
        ]
      : undefined,
    series,
  }
})
</script>

<template>
  <EChart :option="option" :height="height" />
</template>
