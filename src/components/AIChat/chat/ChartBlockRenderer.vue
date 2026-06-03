<script setup lang="ts">
import { computed } from 'vue'
import type {
  BarChartRenderData,
  ChartPayload,
  HeatmapChartRenderData,
  LineChartRenderData,
  PieChartRenderData,
} from '@openchatlab/core'
import EChartBar from '@/components/charts/EChartBar.vue'
import EChartHeatmap from '@/components/charts/EChartHeatmap.vue'
import EChartLine from '@/components/charts/EChartLine.vue'
import EChartPie from '@/components/charts/EChartPie.vue'

const props = defineProps<{
  chart: ChartPayload
}>()

const title = computed(() => props.chart.spec.title)
const subtitle = computed(() => props.chart.spec.subtitle || props.chart.spec.description || '')
const height = computed(() => props.chart.spec.display?.height ?? (props.chart.spec.type === 'heatmap' ? 300 : 260))
const isEmpty = computed(() => props.chart.rowCount === 0)

const summary = computed(() => {
  const parts: string[] = []
  if (props.chart.spec.unit) parts.push(props.chart.spec.unit)
  if (props.chart.truncated) parts.push('truncated')
  parts.push(`${props.chart.rowCount} rows`)
  return parts.join(' · ')
})

const barData = computed(() => props.chart.data as BarChartRenderData)
const lineData = computed(() => props.chart.data as LineChartRenderData)
const pieData = computed(() => props.chart.data as PieChartRenderData)
const heatmapData = computed(() => props.chart.data as HeatmapChartRenderData)
</script>

<template>
  <div
    class="my-2 w-full overflow-hidden rounded-lg border border-gray-200 bg-white/80 shadow-sm dark:border-gray-700/70 dark:bg-gray-900/70"
  >
    <div class="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
      <div class="flex min-w-0 items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{{ title }}</h3>
          <p v-if="subtitle" class="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
            {{ subtitle }}
          </p>
        </div>
        <span
          class="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500 dark:bg-gray-800"
        >
          {{ chart.spec.type }}
        </span>
      </div>
      <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{{ summary }}</p>
    </div>

    <div class="px-2 py-3">
      <div v-if="isEmpty" class="flex h-32 items-center justify-center text-xs text-gray-400 dark:text-gray-500">
        No data
      </div>
      <EChartBar
        v-else-if="chart.spec.type === 'bar'"
        :data="barData"
        :height="height"
        :horizontal="chart.spec.display?.horizontal"
      />
      <EChartLine v-else-if="chart.spec.type === 'line'" :data="lineData" :height="height" />
      <EChartPie
        v-else-if="chart.spec.type === 'pie'"
        :data="pieData"
        :height="height"
        :show-legend="chart.spec.display?.showLegend ?? true"
      />
      <EChartHeatmap v-else-if="chart.spec.type === 'heatmap'" :data="heatmapData" :height="height" />
    </div>
  </div>
</template>
