<script setup lang="ts">
/**
 * ECharts 词云图组件
 * 使用 echarts-wordcloud 扩展
 */
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { TooltipComponent } from 'echarts/components'
import 'echarts-wordcloud'

// 注册必要的组件
echarts.use([CanvasRenderer, TooltipComponent])

export interface WordcloudData {
  words: Array<{
    word: string
    count: number
    percentage?: number
  }>
}

interface Props {
  data: WordcloudData
  height?: number | string
  loading?: boolean
  /** 最大显示词数 */
  maxWords?: number
  /** 颜色方案 */
  colorScheme?: 'default' | 'warm' | 'cool' | 'rainbow'
  /** 字体大小倍率 (0.5-2.0) */
  sizeScale?: number
}

const props = withDefaults(defineProps<Props>(), {
  height: 400,
  loading: false,
  maxWords: 100,
  colorScheme: 'default',
  sizeScale: 1,
})

const emit = defineEmits<{
  /** 词语点击事件 */
  wordClick: [word: string, count: number]
}>()

const chartRef = ref<HTMLDivElement>()
let chartInstance: echarts.ECharts | null = null

// 计算高度样式
const heightStyle = computed(() => {
  if (typeof props.height === 'number') {
    return `${props.height}px`
  }
  return props.height
})

// 检测暗色模式
const isDark = computed(() => {
  return document.documentElement.classList.contains('dark')
})

// 颜色方案
const colorSchemes = {
  default: ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#22c55e', '#14b8a6', '#3b82f6'],
  warm: ['#f97316', '#fb923c', '#fbbf24', '#facc15', '#f59e0b', '#ea580c', '#dc2626', '#ef4444'],
  cool: ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#14b8a6', '#06b6d4', '#0ea5e9', '#0284c7'],
  rainbow: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'],
}

// 获取词云配置
const getOption = () => {
  const words = props.data.words.slice(0, props.maxWords)
  if (words.length === 0) return null

  // 计算最大和最小值用于归一化
  const maxCount = Math.max(...words.map((w) => w.count))
  const minCount = Math.min(...words.map((w) => w.count))
  const range = maxCount - minCount || 1

  const colors = colorSchemes[props.colorScheme]

  // 基础字体大小范围
  const baseSizeMin = 14
  const baseSizeMax = 56
  // 根据缩放倍率调整
  const sizeMin = Math.round(baseSizeMin * props.sizeScale)
  const sizeMax = Math.round(baseSizeMax * props.sizeScale)
  const sizeRange = sizeMax - sizeMin

  // 转换为 echarts-wordcloud 格式，每个词直接指定颜色
  const seriesData = words.map((item, index) => {
    // 归一化字体大小
    const normalized = (item.count - minCount) / range
    const fontSize = Math.round(sizeMin + normalized * sizeRange)
    // 为每个词分配一个颜色
    const color = colors[index % colors.length]

    return {
      name: item.word,
      value: item.count,
      textStyle: {
        fontSize,
        color,
      },
    }
  })

  return {
    backgroundColor: 'transparent',
    tooltip: {
      show: true,
      formatter: (params: { name: string; value: number }) => {
        const word = words.find((w) => w.word === params.name)
        const percentage = word?.percentage ? ` (${word.percentage}%)` : ''
        return `${params.name}: ${params.value}次${percentage}`
      },
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: 'transparent',
      textStyle: {
        color: '#fff',
      },
    },
    series: [
      {
        type: 'wordCloud',
        // 词云形状：circle, cardioid, diamond, triangle-forward, triangle, pentagon, star
        shape: 'circle',
        // 填满整个容器（无边距）
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
        // 词间距（更紧凑）
        gridSize: Math.max(2, Math.round(4 * props.sizeScale)),
        // 文字大小范围（根据缩放调整）
        sizeRange: [sizeMin, sizeMax],
        // 文字旋转范围
        rotationRange: [-45, 45],
        rotationStep: 15,
        // 允许词语部分超出画布
        drawOutOfBound: false,
        // 布局动画
        layoutAnimation: true,
        // 全局文本样式
        textStyle: {
          fontFamily: 'sans-serif',
          fontWeight: 'bold',
        },
        // 高亮样式
        emphasis: {
          focus: 'self',
          textStyle: {
            shadowBlur: 10,
            shadowColor: isDark.value ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.3)',
          },
        },
        data: seriesData,
      },
    ],
  }
}

// 初始化图表
function initChart() {
  if (!chartRef.value) return

  // 销毁旧实例
  if (chartInstance) {
    chartInstance.dispose()
  }

  // 创建新实例（不使用主题，避免覆盖词云颜色）
  chartInstance = echarts.init(chartRef.value)

  const option = getOption()
  if (option) {
    chartInstance.setOption(option)
  }

  // 绑定点击事件
  chartInstance.on('click', (params) => {
    if (params.componentType === 'series' && params.seriesType === 'wordCloud') {
      emit('wordClick', params.name, params.value as number)
    }
  })
}

// 更新图表
function updateChart() {
  if (!chartInstance) {
    initChart()
    return
  }

  const option = getOption()
  if (option) {
    chartInstance.setOption(option, { notMerge: true })
  }
}

// 调整大小
function handleResize() {
  chartInstance?.resize()
}

// 监听数据变化
watch(() => props.data, updateChart, { deep: true })

// 监听颜色方案变化
watch(() => props.colorScheme, updateChart)

// 监听字体大小倍率变化
watch(() => props.sizeScale, updateChart)

// 监听主题变化
watch(isDark, () => {
  initChart()
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
  initChart()
  window.addEventListener('resize', handleResize)

  // 监听 HTML 元素的 class 变化（用于检测暗色模式切换）
  observer = new MutationObserver(() => {
    initChart()
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  observer?.disconnect()
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
  <div ref="chartRef" :style="{ height: heightStyle, width: '100%' }" />
</template>
