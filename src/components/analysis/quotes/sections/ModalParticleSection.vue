<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { ThemeCard } from '@/components/UI'
import type { MemberLanguageProfile } from '@/types/quotes/languagePreference'

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

const { t } = useI18n()
const isDark = useDark()

const props = defineProps<{
  members: MemberLanguageProfile[]
}>()

const memberA = computed(() => props.members[0])
const memberB = computed(() => props.members[1])

const SOFT_WORDS = new Set(['呀', '哒', '滴', '啦', '哇', '耶'])
const CURIOUS_WORDS = new Set(['呢', '吗', '嘛'])
const CASUAL_WORDS = new Set(['吧', '喔', '噢', '嘛'])
const CALM_WORDS = new Set(['嗯', '哦', '额', '呃'])

function getToneLabel(m: MemberLanguageProfile): { label: string; colorClass: string } {
  const mixedResponse = {
    label: t('quotes.languagePreference.modal.toneMixed'),
    colorClass:
      'bg-gray-50 text-gray-600 ring-1 ring-gray-900/5 dark:bg-gray-800/50 dark:text-gray-400 dark:ring-white/10',
  }
  if (m.modalParticles.length === 0) return mixedResponse
  let soft = 0,
    curious = 0,
    casual = 0,
    calm = 0,
    total = 0
  for (const p of m.modalParticles) {
    total += p.count
    if (SOFT_WORDS.has(p.word)) soft += p.count
    if (CURIOUS_WORDS.has(p.word)) curious += p.count
    if (CASUAL_WORDS.has(p.word)) casual += p.count
    if (CALM_WORDS.has(p.word)) calm += p.count
  }
  if (total === 0) return mixedResponse
  const max = Math.max(soft, curious, casual, calm)
  if (max === soft && soft / total > 0.3)
    return {
      label: t('quotes.languagePreference.modal.toneSoft'),
      colorClass:
        'bg-pink-50 text-pink-600 ring-1 ring-pink-500/20 dark:bg-pink-500/10 dark:text-pink-400 dark:ring-pink-500/30',
    }
  if (max === curious && curious / total > 0.3)
    return {
      label: t('quotes.languagePreference.modal.toneCurious'),
      colorClass:
        'bg-violet-50 text-violet-600 ring-1 ring-violet-500/20 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/30',
    }
  if (max === casual && casual / total > 0.3)
    return {
      label: t('quotes.languagePreference.modal.toneCasual'),
      colorClass:
        'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/30',
    }
  if (max === calm && calm / total > 0.3)
    return {
      label: t('quotes.languagePreference.modal.toneCalm'),
      colorClass:
        'bg-blue-50 text-blue-600 ring-1 ring-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/30',
    }
  return mixedResponse
}

const chartRefA = ref<HTMLElement | null>(null)
const chartRefB = ref<HTMLElement | null>(null)
let chartA: echarts.ECharts | null = null
let chartB: echarts.ECharts | null = null

function buildBarOption(member: MemberLanguageProfile, color: string) {
  const items = member.modalParticles.slice(0, 8)
  const textColor = isDark.value ? '#9ca3af' : '#6b7280'
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 40, right: 20, top: 4, bottom: 4 },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category',
      data: items.map((i) => i.word).reverse(),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 12, color: textColor },
      inverse: false,
    },
    series: [
      {
        type: 'bar',
        data: items.map((i) => i.count).reverse(),
        itemStyle: { color, borderRadius: [0, 4, 4, 0] },
        barWidth: '50%',
        label: {
          show: true,
          position: 'right',
          fontSize: 10,
          color: textColor,
          formatter: '{c}',
        },
      },
    ],
  }
}

function initCharts() {
  if (chartRefA.value && memberA.value) {
    chartA = echarts.init(chartRefA.value, undefined, { renderer: 'canvas' })
    chartA.setOption(buildBarOption(memberA.value, '#3b82f6'), { notMerge: true })
  }
  if (chartRefB.value && memberB.value) {
    chartB = echarts.init(chartRefB.value, undefined, { renderer: 'canvas' })
    chartB.setOption(buildBarOption(memberB.value, '#ec4899'), { notMerge: true })
  }
}

function handleResize() {
  chartA?.resize()
  chartB?.resize()
}

watch(
  () => props.members,
  () => {
    if (chartA && memberA.value) chartA.setOption(buildBarOption(memberA.value, '#3b82f6'), { notMerge: true })
    if (chartB && memberB.value) chartB.setOption(buildBarOption(memberB.value, '#ec4899'), { notMerge: true })
  },
  { deep: true }
)

watch(isDark, () => {
  chartA?.dispose()
  chartB?.dispose()
  initCharts()
})

onMounted(() => {
  initCharts()
  window.addEventListener('resize', handleResize)
})
onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  chartA?.dispose()
  chartB?.dispose()
})
</script>

<template>
  <ThemeCard>
    <div class="px-5 py-4 sm:px-6">
      <div class="mb-4 flex items-center gap-2">
        <UIcon name="i-heroicons-chat-bubble-oval-left-ellipsis" class="h-4 w-4 text-pink-500" />
        <span class="text-[15px] font-black tracking-tight text-gray-900 dark:text-white">
          {{ t('quotes.languagePreference.modal.title') }}
        </span>
      </div>

      <div v-if="memberA && memberB" class="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div v-for="(m, idx) in [memberA, memberB]" :key="m.memberId">
          <div class="mb-2 flex items-center justify-between">
            <span
              class="text-sm font-semibold"
              :class="idx === 0 ? 'text-blue-600 dark:text-blue-400' : 'text-pink-600 dark:text-pink-400'"
            >
              {{ m.name }}
            </span>
            <span class="rounded-full px-2 py-0.5 text-[10px] font-bold" :class="getToneLabel(m).colorClass">
              {{ getToneLabel(m).label }}
            </span>
          </div>
          <div
            v-if="m.modalParticles.length > 0"
            :ref="
              (el) => {
                if (idx === 0) chartRefA = el as HTMLElement
                else chartRefB = el as HTMLElement
              }
            "
            style="width: 100%; height: 200px"
          />
          <div v-else class="flex h-[200px] items-center justify-center text-sm text-gray-400">
            {{ t('quotes.languagePreference.modal.empty') }}
          </div>
        </div>
      </div>
    </div>
  </ThemeCard>
</template>
