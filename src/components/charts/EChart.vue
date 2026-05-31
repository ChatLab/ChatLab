<script setup lang="ts">
/**
 * ECharts 基础封装组件
 * 提供自动响应式、主题适配、加载状态等通用功能
 */
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { PieChart, BarChart, LineChart, HeatmapChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  VisualMapComponent,
} from 'echarts/components'
import type { EChartsOption } from 'echarts'

// 注册必要的组件
echarts.use([
  CanvasRenderer,
  PieChart,
  BarChart,
  LineChart,
  HeatmapChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  VisualMapComponent,
])

interface Props {
  option: EChartsOption
  height?: number | string
  loading?: boolean
  theme?: 'light' | 'dark' | 'auto'
}

const props = withDefaults(defineProps<Props>(), {
  height: 300,
  loading: false,
  theme: 'auto',
})

const chartRef = ref<HTMLDivElement>()
let chartInstance: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null
let pendingInitFrame = 0

// 计算高度样式
const heightStyle = computed(() => {
  if (typeof props.height === 'number') {
    return `${props.height}px`
  }
  return props.height
})

// 检测暗色模式
const isDark = computed(() => {
  if (props.theme === 'auto') {
    return document.documentElement.classList.contains('dark')
  }
  return props.theme === 'dark'
})

function getChartSize(): { width: number; height: number } {
  const el = chartRef.value
  if (!el) return { width: 0, height: 0 }
  return {
    width: el.clientWidth,
    height: el.clientHeight,
  }
}

// 初始化图表
async function initChart(retry = 0) {
  await nextTick()
  if (!chartRef.value) return

  const { width, height } = getChartSize()
  if ((width === 0 || height === 0) && retry < 8) {
    pendingInitFrame = window.requestAnimationFrame(() => {
      void initChart(retry + 1)
    })
    return
  }

  // 销毁旧实例
  if (chartInstance) {
    chartInstance.dispose()
  }

  // 创建新实例
  chartInstance = echarts.init(chartRef.value, isDark.value ? 'dark' : undefined)
  chartInstance.setOption({ backgroundColor: 'transparent', ...props.option })
  chartInstance.resize()
}

// 更新图表
function updateChart() {
  if (!chartInstance) {
    void initChart()
    return
  }
  chartInstance.setOption({ backgroundColor: 'transparent', ...props.option }, { notMerge: true })
  handleResize()
}

// 调整大小
function handleResize() {
  window.requestAnimationFrame(() => {
    chartInstance?.resize()
  })
}

// 监听 option 变化
watch(() => props.option, updateChart, { deep: true, flush: 'post' })

// 监听高度变化
watch(
  () => props.height,
  () => {
    // 使用 nextTick 确保 DOM 更新后再调整大小
    setTimeout(() => {
      chartInstance?.resize()
    }, 0)
  }
)

// 监听主题变化
watch(isDark, () => {
  void initChart()
})

// 监听加载状态
watch(
  () => props.loading,
  (loading) => {
    if (loading) {
      chartInstance?.showLoading('default', {
        text: '',
        spinnerRadius: 12,
        lineWidth: 2,
      })
    } else {
      chartInstance?.hideLoading()
    }
  }
)

// 监听暗色模式变化
let observer: MutationObserver | null = null

onMounted(() => {
  void initChart()
  window.addEventListener('resize', handleResize)

  if (chartRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (!chartInstance) {
        void initChart()
        return
      }
      handleResize()
    })
    resizeObserver.observe(chartRef.value)
  }

  // 监听 HTML 元素的 class 变化（用于检测暗色模式切换）
  observer = new MutationObserver(() => {
    if (props.theme === 'auto') {
      void initChart()
    }
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
})

onUnmounted(() => {
  if (pendingInitFrame) {
    window.cancelAnimationFrame(pendingInitFrame)
    pendingInitFrame = 0
  }
  window.removeEventListener('resize', handleResize)
  observer?.disconnect()
  resizeObserver?.disconnect()
  chartInstance?.dispose()
  chartInstance = null
})

// 暴露方法供父组件调用
defineExpose({
  getInstance: () => chartInstance,
  resize: handleResize,
})
</script>

<template>
  <div ref="chartRef" class="min-w-0" :style="{ height: heightStyle, width: '100%' }" />
</template>
