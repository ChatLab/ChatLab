<script setup lang="ts">
/**
 * ECharts 关系图组件（支持 circular 和 force 布局）
 */
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts/core'
import { GraphChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useDark } from '@vueuse/core'
import type { EChartsOption } from 'echarts'

// 注册必要的组件
echarts.use([GraphChart, TooltipComponent, LegendComponent, CanvasRenderer])

type ECOption = EChartsOption

export interface GraphNode {
  id: number | string
  name: string
  value?: number
  symbolSize?: number
  category?: number
}

export interface GraphLink {
  source: string
  target: string
  value?: number
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
  maxLinkValue?: number
}

interface Props {
  data: GraphData
  height?: number | string
  layout?: 'circular' | 'force' // 布局类型
  directed?: boolean // 是否显示箭头（有向图）
}

const props = withDefaults(defineProps<Props>(), {
  height: 400,
  layout: 'circular',
  directed: false,
})

// 计算高度样式
const heightStyle = computed(() => {
  if (typeof props.height === 'number') {
    return `${props.height}px`
  }
  return props.height
})

const isDark = useDark()
const chartRef = ref<HTMLElement | null>(null)
let chartInstance: echarts.ECharts | null = null

// 丰富的调色板（为每个节点分配不同颜色）
const colorPalette = [
  '#ee4567', // 粉色（主题色）
  '#5470c6', // 蓝色
  '#91cc75', // 绿色
  '#fac858', // 黄色
  '#ee6666', // 红色
  '#73c0de', // 青色
  '#9a60b4', // 紫色
  '#fc8452', // 橙色
  '#3ba272', // 深绿
  '#ea7ccc', // 粉紫
  '#6e7074', // 灰色
  '#546570', // 深灰蓝
]

// 去重后的节点（ECharts 要求节点名称唯一）
const uniqueNodes = computed(() => {
  const seen = new Set<string>()
  return props.data.nodes.filter((node) => {
    if (seen.has(node.name)) {
      return false
    }
    seen.add(node.name)
    return true
  })
})

// 节点名称到颜色的映射
const nodeColorMap = computed(() => {
  const map = new Map<string, string>()
  uniqueNodes.value.forEach((node, index) => {
    map.set(node.name, colorPalette[index % colorPalette.length])
  })
  return map
})

// 计算边的宽度（根据 value 归一化）
function getLinkWidth(value: number, maxValue: number): number {
  if (maxValue <= 0) return 1
  // 宽度范围 1-6
  return 1 + (value / maxValue) * 5
}

const option = computed<ECOption>(() => {
  const maxLinkValue = props.data.maxLinkValue || Math.max(...props.data.links.map((l) => l.value || 1), 1)

  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: isDark.value ? 'rgba(30, 30, 30, 0.9)' : 'rgba(255, 255, 255, 0.95)',
      borderColor: isDark.value ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
      textStyle: {
        color: isDark.value ? '#e5e7eb' : '#374151',
      },
      formatter: (params: any) => {
        if (params.dataType === 'node') {
          return `<b>${params.data.name}</b><br/>消息数: ${params.data.value || 0}`
        } else if (params.dataType === 'edge') {
          return `${params.data.source} → ${params.data.target}<br/>艾特次数: ${params.data.value || 0}`
        }
        return ''
      },
    },
    // 动画效果
    animationDuration: 1000,
    animationDurationUpdate: 500,
    animationEasingUpdate: 'quinticInOut',
    series: [
      {
        type: 'graph',
        layout: props.layout,
        circular: props.layout === 'circular' ? { rotateLabel: true } : undefined,
        force:
          props.layout === 'force'
            ? {
                repulsion: 300,
                gravity: 0.1,
                edgeLength: [80, 200],
                friction: 0.6,
              }
            : undefined,
        roam: true,
        scaleLimit: {
          min: 0.3, // 最小缩放 30%
          max: 3, // 最大缩放 300%
        },
        draggable: true,
        label: {
          show: true,
          position: 'right',
          formatter: '{b}',
          color: isDark.value ? '#e5e7eb' : '#374151',
          fontSize: 11,
          fontWeight: 500,
        },
        edgeSymbol: props.directed ? ['none', 'arrow'] : ['none', 'none'],
        edgeSymbolSize: props.directed ? [0, 10] : [0, 0],
        lineStyle: {
          curveness: 0.3, // 始终使用曲线
          opacity: 0.5,
        },
        emphasis: {
          focus: 'adjacency',
          label: {
            show: true,
            fontSize: 13,
            fontWeight: 600,
          },
          lineStyle: {
            width: 4,
            opacity: 0.9,
          },
          itemStyle: {
            shadowBlur: 15,
            shadowColor: 'rgba(0, 0, 0, 0.3)',
          },
        },
        // 节点数据（使用去重后的节点）
        data: uniqueNodes.value.map((node) => {
          const color = nodeColorMap.value.get(node.name) || colorPalette[0]
          return {
            name: node.name,
            value: node.value,
            symbolSize: node.symbolSize || 30,
            // circular 布局显示所有标签，force 布局只显示大节点的标签
            label: {
              show: props.layout === 'circular' ? true : (node.symbolSize || 30) > 30,
            },
            itemStyle: {
              color: color,
              borderColor: '#fff',
              borderWidth: 2,
              shadowBlur: 5,
              shadowColor: `${color}66`, // 同色系阴影
            },
          }
        }),
        // 连接线数据（颜色跟随源节点，过滤掉引用不存在节点的链接）
        links: props.data.links
          .filter((link) => nodeColorMap.value.has(link.source) && nodeColorMap.value.has(link.target))
          .map((link) => {
            const sourceColor = nodeColorMap.value.get(link.source) || colorPalette[0]
            return {
              source: link.source,
              target: link.target,
              value: link.value,
              lineStyle: {
                color: sourceColor,
                width: getLinkWidth(link.value || 1, maxLinkValue),
              },
            }
          }),
      },
    ],
  }
})

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

// 重置视图（居中 + 重置缩放）
function resetView() {
  if (!chartInstance) return
  chartInstance.dispatchAction({
    type: 'restore',
  })
}

// 暴露方法给父组件
defineExpose({
  resetView,
})

// 监听数据和主题变化
watch(
  [() => props.data, () => props.layout, () => props.directed, isDark],
  () => {
    if (chartInstance) {
      updateChart()
    } else {
      initChart()
    }
  },
  { deep: true }
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
  <div ref="chartRef" :style="{ height: heightStyle, width: '100%' }" />
</template>
