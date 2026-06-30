<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
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

const { t } = useI18n()

const props = defineProps<{
  chart: ChartPayload
}>()

const isExpandedOpen = ref(false)
const title = computed(() => props.chart.spec.title)
const subtitle = computed(() => props.chart.spec.subtitle || props.chart.spec.description || '')
const height = computed(() => props.chart.spec.display?.height ?? (props.chart.spec.type === 'heatmap' ? 300 : 260))
const isEmpty = computed(() => props.chart.rowCount === 0)

const summary = computed(() => {
  const parts: string[] = []
  if (props.chart.spec.unit) parts.push(props.chart.spec.unit)
  if (props.chart.truncated) parts.push(t('ai.chat.message.chart.truncated'))
  parts.push(t('ai.chat.message.chart.rows', { count: props.chart.rowCount }))
  return parts.join(' · ')
})

const barData = computed(() => props.chart.data as BarChartRenderData)
const lineData = computed(() => props.chart.data as LineChartRenderData)
const pieData = computed(() => props.chart.data as PieChartRenderData)
const heatmapData = computed(() => props.chart.data as HeatmapChartRenderData)

const isDenseChart = computed(() => {
  if (props.chart.spec.type === 'pie') return pieData.value.labels.length > 8
  if (props.chart.spec.type === 'line') {
    return lineData.value.labels.length > 28 || (lineData.value.series?.length ?? 0) > 4
  }
  if (props.chart.spec.type === 'bar') return barData.value.labels.length > 12
  if (props.chart.spec.type === 'heatmap') {
    return heatmapData.value.xLabels.length * heatmapData.value.yLabels.length > 180
  }
  return false
})

const compactHeight = computed(() => {
  const maxHeight = isDenseChart.value ? 320 : 380
  return Math.min(height.value, maxHeight)
})

const expandedHeight = computed(() => {
  const requested = height.value
  if (props.chart.spec.type === 'pie') return Math.max(requested, 560)
  if (props.chart.spec.type === 'line') return Math.max(requested, lineData.value.labels.length > 40 ? 620 : 540)
  if (props.chart.spec.type === 'bar') {
    const dynamicHeight = props.chart.spec.display?.horizontal ? barData.value.labels.length * 28 + 120 : 520
    return Math.min(Math.max(requested, dynamicHeight), 820)
  }
  if (props.chart.spec.type === 'heatmap') {
    return Math.min(Math.max(requested, heatmapData.value.yLabels.length * 22 + 150, 560), 860)
  }
  return Math.max(requested, 520)
})

const expandedMinWidth = computed(() => {
  if (props.chart.spec.type === 'pie') return '640px'
  if (props.chart.spec.type === 'bar') return '720px'
  return '780px'
})
</script>

<template>
  <div
    class="my-2 w-full overflow-hidden rounded-lg border border-gray-200 bg-white/80 shadow-sm dark:border-gray-700/70 dark:bg-page-dark/70"
  >
    <div class="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
      <div class="flex min-w-0 items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{{ title }}</h3>
          <p v-if="subtitle" class="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
            {{ subtitle }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <span class="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500 dark:bg-gray-800">
            {{ chart.spec.type }}
          </span>
          <UModal
            v-model:open="isExpandedOpen"
            :ui="{
              overlay: 'z-[10040] backdrop-blur-sm',
              content: 'z-[10050] w-[96vw] max-w-6xl max-h-[92vh] overflow-hidden',
            }"
          >
            <UButton
              icon="i-heroicons-arrows-pointing-out"
              size="xs"
              color="neutral"
              variant="ghost"
              class="no-capture"
              :title="t('ai.chat.message.chart.expand')"
              :aria-label="t('ai.chat.message.chart.expand')"
              @click.stop
            />
            <template #content>
              <div class="flex max-h-[92vh] flex-col overflow-hidden bg-white dark:bg-page-dark">
                <div
                  class="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-800"
                >
                  <div class="min-w-0">
                    <h3 class="truncate text-base font-semibold text-gray-900 dark:text-gray-100">{{ title }}</h3>
                    <p v-if="subtitle" class="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                      {{ subtitle }}
                    </p>
                    <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{{ summary }}</p>
                  </div>
                  <UButton
                    icon="i-heroicons-x-mark"
                    size="sm"
                    color="neutral"
                    variant="ghost"
                    class="shrink-0"
                    :title="t('common.close')"
                    :aria-label="t('common.close')"
                    @click="isExpandedOpen = false"
                  />
                </div>
                <div class="min-h-0 flex-1 overflow-auto p-4">
                  <div class="mx-auto w-full" :style="{ minWidth: expandedMinWidth }">
                    <div
                      v-if="isEmpty"
                      class="flex h-64 items-center justify-center text-xs text-gray-400 dark:text-gray-500"
                    >
                      {{ t('ai.chat.message.chart.empty') }}
                    </div>
                    <EChartBar
                      v-else-if="chart.spec.type === 'bar'"
                      :data="barData"
                      :height="expandedHeight"
                      mode="expanded"
                      :horizontal="chart.spec.display?.horizontal"
                    />
                    <EChartLine
                      v-else-if="chart.spec.type === 'line'"
                      :data="lineData"
                      :height="expandedHeight"
                      mode="expanded"
                    />
                    <EChartPie
                      v-else-if="chart.spec.type === 'pie'"
                      :data="pieData"
                      :height="expandedHeight"
                      mode="expanded"
                      :show-legend="chart.spec.display?.showLegend ?? true"
                    />
                    <EChartHeatmap
                      v-else-if="chart.spec.type === 'heatmap'"
                      :data="heatmapData"
                      :height="expandedHeight"
                      mode="expanded"
                    />
                  </div>
                </div>
              </div>
            </template>
          </UModal>
        </div>
      </div>
      <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{{ summary }}</p>
    </div>

    <div class="px-2 py-3">
      <div v-if="isEmpty" class="flex h-32 items-center justify-center text-xs text-gray-400 dark:text-gray-500">
        {{ t('ai.chat.message.chart.empty') }}
      </div>
      <EChartBar
        v-else-if="chart.spec.type === 'bar'"
        :data="barData"
        :height="compactHeight"
        mode="compact"
        :horizontal="chart.spec.display?.horizontal"
      />
      <EChartLine v-else-if="chart.spec.type === 'line'" :data="lineData" :height="compactHeight" mode="compact" />
      <EChartPie
        v-else-if="chart.spec.type === 'pie'"
        :data="pieData"
        :height="compactHeight"
        mode="compact"
        :show-legend="chart.spec.display?.showLegend ?? true"
      />
      <EChartHeatmap
        v-else-if="chart.spec.type === 'heatmap'"
        :data="heatmapData"
        :height="compactHeight"
        mode="compact"
      />
    </div>
  </div>
</template>
