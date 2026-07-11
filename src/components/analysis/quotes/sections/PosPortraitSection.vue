<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { ThemeCard } from '@/components/UI'
import type { MemberLanguageProfile } from '@/types/quotes/languagePreference'

echarts.use([BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const { t } = useI18n()
const isDark = useDark()

const props = defineProps<{
  members: MemberLanguageProfile[]
}>()

const memberA = computed(() => props.members[0])
const memberB = computed(() => props.members[1])

function getChatStyle(m: MemberLanguageProfile): { label: string; icon: string; colorClass: string } {
  const pos = m.posDistribution
  const total = pos.noun + pos.verb + pos.adjective + pos.adverb + pos.modalParticle + pos.interjection + pos.other
  if (total === 0)
    return {
      label: t('quotes.languagePreference.pos.styleBalanced'),
      icon: 'i-heroicons-scale-solid',
      colorClass: 'text-cyan-600 dark:text-cyan-400',
    }

  const nounR = pos.noun / total
  const verbR = pos.verb / total
  const adjR = pos.adjective / total

  if (nounR > 0.5)
    return {
      label: t('quotes.languagePreference.pos.styleEncyclopedia'),
      icon: 'i-heroicons-book-open-solid',
      colorClass: 'text-indigo-600 dark:text-indigo-400',
    }
  if (verbR > 0.45)
    return {
      label: t('quotes.languagePreference.pos.styleAction'),
      icon: 'i-heroicons-rocket-launch-solid',
      colorClass: 'text-orange-600 dark:text-orange-400',
    }
  if (adjR > 0.3)
    return {
      label: t('quotes.languagePreference.pos.styleExpressive'),
      icon: 'i-heroicons-paint-brush-solid',
      colorClass: 'text-pink-600 dark:text-pink-400',
    }
  return {
    label: t('quotes.languagePreference.pos.styleBalanced'),
    icon: 'i-heroicons-scale-solid',
    colorClass: 'text-cyan-600 dark:text-cyan-400',
  }
}

const chartRef = ref<HTMLElement | null>(null)
let chartInstance: echarts.ECharts | null = null

function initChart() {
  if (!chartRef.value) return
  chartInstance = echarts.init(chartRef.value, undefined, { renderer: 'canvas' })
  updateChart()
}

function updateChart() {
  if (!chartInstance || !memberA.value || !memberB.value) return
  const a = memberA.value.posDistribution
  const b = memberB.value.posDistribution

  const categories = [
    t('quotes.languagePreference.card.radarNoun'),
    t('quotes.languagePreference.card.radarVerb'),
    t('quotes.languagePreference.card.radarAdj'),
    t('quotes.languagePreference.card.radarModal'),
    t('quotes.languagePreference.card.radarAdv'),
  ]
  const valA = [a.noun, a.verb, a.adjective, a.modalParticle + a.interjection, a.adverb]
  const valB = [b.noun, b.verb, b.adjective, b.modalParticle + b.interjection, b.adverb]

  const textColor = isDark.value ? '#9ca3af' : '#6b7280'

  chartInstance.setOption(
    {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: {
        data: [memberA.value.name, memberB.value.name],
        top: 0,
        textStyle: { fontSize: 11, color: textColor },
      },
      grid: { left: 80, right: 20, top: 36, bottom: 10 },
      xAxis: { type: 'value', show: false },
      yAxis: {
        type: 'category',
        data: categories,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 11, color: textColor },
      },
      series: [
        {
          name: memberA.value.name,
          type: 'bar',
          data: valA,
          itemStyle: { color: '#3b82f6', borderRadius: [0, 4, 4, 0] },
          barGap: '20%',
          barCategoryGap: '40%',
        },
        {
          name: memberB.value.name,
          type: 'bar',
          data: valB,
          itemStyle: { color: '#ec4899', borderRadius: [0, 4, 4, 0] },
        },
      ],
    },
    { notMerge: true }
  )
}

function handleResize() {
  chartInstance?.resize()
}
watch(
  () => props.members,
  () => updateChart(),
  { deep: true }
)
watch(isDark, () => {
  chartInstance?.dispose()
  initChart()
})
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
  <ThemeCard>
    <div class="px-5 py-4 sm:px-6">
      <div class="mb-4 flex items-center gap-2">
        <UIcon name="i-heroicons-chart-bar" class="h-4 w-4 text-violet-500" />
        <span class="text-[15px] font-black tracking-tight text-gray-900 dark:text-white">
          {{ t('quotes.languagePreference.pos.title') }}
        </span>
      </div>

      <div class="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <!-- 柱状图 -->
        <div class="flex-1">
          <div ref="chartRef" style="width: 100%; height: 220px" />
        </div>

        <!-- 聊天气质标签 -->
        <div v-if="memberA && memberB" class="flex shrink-0 flex-col gap-3 lg:w-48">
          <div v-for="m in [memberA, memberB]" :key="m.memberId" class="flex min-w-0 items-center gap-3 px-1 py-3">
            <UIcon :name="getChatStyle(m).icon" class="h-5 w-5 shrink-0" :class="getChatStyle(m).colorClass" />
            <div class="min-w-0">
              <div class="truncate text-xs font-semibold text-gray-500 dark:text-gray-400">{{ m.name }}</div>
              <div class="truncate text-sm font-bold" :class="getChatStyle(m).colorClass">
                {{ getChatStyle(m).label }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </ThemeCard>
</template>
