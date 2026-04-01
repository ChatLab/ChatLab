<script setup lang="ts">
/**
 * ECharts 日历热力图组件（GitHub 贡献图风格）
 */
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts/core'
import { HeatmapChart } from 'echarts/charts'
import { CalendarComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useDark } from '@vueuse/core'
import type { EChartsOption } from 'echarts'

// 注册必要的组件
echarts.use([HeatmapChart, CalendarComponent, TooltipComponent, VisualMapComponent, CanvasRenderer])

type ECOption = EChartsOption

export interface CalendarData {
  date: string // YYYY-MM-DD
  value: number
}

interface Props {
  data: CalendarData[]
  height?: number
  year?: number // 指定年份，不指定则自动计算
}

const props = withDefaults(defineProps<Props>(), {
  height: 180,
})

const { t, locale } = useI18n()
const isDark = useDark()
const chartRef = ref<HTMLElement | null>(null)
let chartInstance: echarts.ECharts | null = null

// 计算年份范围
const yearRange = computed(() => {
  if (props.year) return props.year

  if (props.data.length === 0) {
    return new Date().getFullYear()
  }

  // 找到数据中最大的年份
  const years = props.data.map((d) => parseInt(d.date.split('-')[0]))
  return Math.max(...years)
})

// 计算最大值（用于颜色映射）
const maxValue = computed(() => {
  if (props.data.length === 0) return 10
  return Math.max(...props.data.map((d) => d.value), 1)
})

// 转换数据格式为 ECharts 需要的格式
const chartData = computed(() => {
  return props.data.map((d) => [d.date, d.value])
})

// 项目主题粉色
const themeColors = {
  light: ['#fee5e8', '#fbb5c2', '#f7758c', '#ee4567'],
  dark: ['#3d1f24', '#6b2f3a', '#a34557', '#ee4567'],
}

const option = computed<ECOption>(() => ({
  tooltip: {
    trigger: 'item',
    formatter: (params: any) => {
      const date = params.data[0]
      const value = params.data[1]
      return `${date}<br/>${t('views.message.calendarTooltipMessages')}: ${value}`
    },
  },
  visualMap: {
    min: 0,
    max: maxValue.value,
    calculable: false,
    orient: 'horizontal',
    left: 'center',
    bottom: 0,
    itemWidth: 10,
    itemHeight: 100,
    text: [`${maxValue.value}`, '0'], // 显示实际的最大值
    inRange: {
      color: isDark.value ? themeColors.dark : themeColors.light,
    },
    textStyle: {
      color: isDark.value ? '#9ca3af' : '#6b7280',
      fontSize: 10,
    },
    show: true,
  },
  calendar: {
    top: 30,
    left: 40,
    cellSize: [13, 13], // 显式设置正方形格子
    range: String(yearRange.value),
    itemStyle: {
      borderWidth: 2,
      borderColor: isDark.value ? '#1f2937' : '#ffffff',
    },
    yearLabel: {
      show: true,
      position: 'top',
      color: isDark.value ? '#9ca3af' : '#6b7280',
      fontSize: 12,
    },
    monthLabel: {
      show: true,
      color: isDark.value ? '#9ca3af' : '#6b7280',
      fontSize: 10,
      nameMap: [
        t('common.month.jan'),
        t('common.month.feb'),
        t('common.month.mar'),
        t('common.month.apr'),
        t('common.month.may'),
        t('common.month.jun'),
        t('common.month.jul'),
        t('common.month.aug'),
        t('common.month.sep'),
        t('common.month.oct'),
        t('common.month.nov'),
        t('common.month.dec'),
      ],
    },
    dayLabel: {
      show: true,
      firstDay: 1, // 从周一开始
      color: isDark.value ? '#6b7280' : '#9ca3af',
      fontSize: 10,
      nameMap: [
        t('common.weekday.sun'),
        t('common.weekday.mon'),
        t('common.weekday.tue'),
        t('common.weekday.wed'),
        t('common.weekday.thu'),
        t('common.weekday.fri'),
        t('common.weekday.sat'),
      ],
    },
    splitLine: {
      show: false,
    },
  },
  series: [
    {
      type: 'heatmap',
      coordinateSystem: 'calendar',
      data: chartData.value,
    },
  ],
}))

// 初始化图表
function initChart() {
  if (!chartRef.value) return

  chartInstance = echarts.init(chartRef.value, isDark.value ? 'dark' : undefined, {
    renderer: 'canvas',
  })
  chartInstance.setOption({ backgroundColor: 'transparent', ...option.value })
}

// 更新图表
function updateChart() {
  if (!chartInstance) return
  chartInstance.setOption({ backgroundColor: 'transparent', ...option.value }, { notMerge: true })
}

// 响应窗口大小变化
function handleResize() {
  chartInstance?.resize()
}

// 监听数据、主题、语言变化
watch([() => props.data, isDark, locale], () => {
  updateChart()
})

watch(
  () => props.year,
  () => {
    updateChart()
  }
)

onMounted(() => {
  initChart()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  chartInstance?.dispose()
})
</script>

<template>
  <div ref="chartRef" :style="{ height: `${height}px`, width: '100%' }" />
</template>
