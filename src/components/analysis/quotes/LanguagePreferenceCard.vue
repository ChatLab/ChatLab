<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import * as echarts from 'echarts/core'
import { RadarChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { CardCaptureOverlay, CardDecoration, ThemeCard } from '@/components/UI'
import type {
  LanguagePreferenceResult,
  MemberLanguageProfile,
  PunctuationStats,
} from '@/types/quotes/languagePreference'

echarts.use([RadarChart, TooltipComponent, CanvasRenderer])

const { t } = useI18n()
const isDark = useDark()

const props = defineProps<{
  data: LanguagePreferenceResult
}>()

const emit = defineEmits<{
  wordClick: [word: string]
}>()

const memberA = computed<MemberLanguageProfile | undefined>(() => props.data.members[0])
const memberB = computed<MemberLanguageProfile | undefined>(() => props.data.members[1])

// ==================== 工具函数 ====================

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…'
}

function getChatStyle(m: MemberLanguageProfile): string {
  const pos = m.posDistribution
  const total = pos.noun + pos.verb + pos.adjective + pos.adverb + pos.modalParticle + pos.interjection + pos.other
  if (total === 0) return t('quotes.languagePreference.pos.styleBalanced')
  if (pos.noun / total > 0.5) return t('quotes.languagePreference.pos.styleEncyclopedia')
  if (pos.verb / total > 0.45) return t('quotes.languagePreference.pos.styleAction')
  if (pos.adjective / total > 0.3) return t('quotes.languagePreference.pos.styleExpressive')
  return t('quotes.languagePreference.pos.styleBalanced')
}

function getPunctPersonality(p: PunctuationStats): string {
  const entries: [string, number][] = [
    ['ellipsis', p.ellipsis],
    ['exclamation', p.exclamation],
    ['question', p.question],
    ['tilde', p.tilde],
    ['noPunct', p.noPunct],
    ['period', p.period],
  ]
  const max = entries.reduce((a, b) => (a[1] >= b[1] ? a : b))
  const map: Record<string, string> = {
    ellipsis: t('quotes.languagePreference.punctuation.personalityDeep'),
    exclamation: t('quotes.languagePreference.punctuation.personalityPassionate'),
    question: t('quotes.languagePreference.punctuation.personalityCurious'),
    tilde: t('quotes.languagePreference.punctuation.personalityCheerful'),
    noPunct: t('quotes.languagePreference.punctuation.personalityFreeflow'),
    period: t('quotes.languagePreference.punctuation.personalityPrecise'),
  }
  return map[max[0]] || '-'
}

function getTopPunctList(p: PunctuationStats, topN = 5): string[] {
  const symbols: [string, number][] = [
    ['...', p.ellipsis],
    ['！', p.exclamation],
    ['？', p.question],
    ['～', p.tilde],
    ['。', p.period],
  ]
  return symbols
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([s]) => s)
}

const TAG_COLORS = [
  '#6366f1',
  '#ec4899',
  '#f97316',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#14b8a6',
  '#f43f5e',
  '#eab308',
  '#06b6d4',
]

// ==================== 3 个合并指标卡 ====================

interface MergedCard {
  icon: string
  iconBgClass: string
  iconColorClass: string
  title: string
  leftName: string
  leftValue: string
  rightName: string
  rightValue: string
  valueClass: string
  detail:
    | { kind: 'tags-vs'; leftTags: string[]; rightTags: string[] }
    | { kind: 'tags-single'; tags: { word: string; color: string }[] }
  desc: string
}

const mergedCards = computed<MergedCard[]>(() => {
  const a = memberA.value
  const b = memberB.value
  if (!a || !b) return []

  const sharedTags = props.data.sharedWords
    .slice(0, 6)
    .map((w, i) => ({ word: w.word, color: TAG_COLORS[i % TAG_COLORS.length] }))

  return [
    {
      icon: 'i-heroicons-book-open',
      iconBgClass: 'bg-blue-100 dark:bg-blue-500/20',
      iconColorClass: 'text-blue-600 dark:text-blue-400',
      title: t('quotes.languagePreference.card.diversityTitle'),
      leftName: a.name,
      leftValue: `${a.lexicalDiversity}%`,
      rightName: b.name,
      rightValue: `${b.lexicalDiversity}%`,
      valueClass: 'text-lg text-blue-600 dark:text-blue-400',
      detail: { kind: 'tags-single' as const, tags: sharedTags },
      desc: t('quotes.languagePreference.card.diversityDesc'),
    },
    {
      icon: 'i-heroicons-sparkles',
      iconBgClass: 'bg-violet-100 dark:bg-violet-500/20',
      iconColorClass: 'text-violet-600 dark:text-violet-400',
      title: t('quotes.languagePreference.card.styleTitle'),
      leftName: a.name,
      leftValue: getChatStyle(a),
      rightName: b.name,
      rightValue: getChatStyle(b),
      valueClass: 'text-xs text-violet-600 dark:text-violet-400',
      detail: {
        kind: 'tags-vs' as const,
        leftTags: a.modalParticles.slice(0, 4).map((p) => p.word),
        rightTags: b.modalParticles.slice(0, 4).map((p) => p.word),
      },
      desc: t('quotes.languagePreference.card.styleDesc'),
    },
    {
      icon: 'i-heroicons-finger-print',
      iconBgClass: 'bg-orange-100 dark:bg-orange-500/20',
      iconColorClass: 'text-orange-600 dark:text-orange-400',
      title: t('quotes.languagePreference.card.punctTitle'),
      leftName: a.name,
      leftValue: getPunctPersonality(a.punctuation),
      rightName: b.name,
      rightValue: getPunctPersonality(b.punctuation),
      valueClass: 'text-xs text-orange-600 dark:text-orange-400',
      detail: {
        kind: 'tags-vs' as const,
        leftTags: getTopPunctList(a.punctuation, 4),
        rightTags: getTopPunctList(b.punctuation, 4),
      },
      desc: t('quotes.languagePreference.card.punctDesc'),
    },
  ]
})

// ==================== 双人雷达图 ====================

const radarRef = ref<HTMLElement | null>(null)
let radarInstance: echarts.ECharts | null = null

function initRadar() {
  if (!radarRef.value) return
  radarInstance = echarts.init(radarRef.value, undefined, { renderer: 'canvas' })
  updateRadar()
}

function updateRadar() {
  if (!radarInstance || !memberA.value || !memberB.value) return
  const a = memberA.value.posDistribution
  const b = memberB.value.posDistribution

  const indicators = [
    { name: t('quotes.languagePreference.card.radarFactual'), max: 0 },
    { name: t('quotes.languagePreference.card.radarActive'), max: 0 },
    { name: t('quotes.languagePreference.card.radarDescriptive'), max: 0 },
    { name: t('quotes.languagePreference.card.radarAffable'), max: 0 },
    { name: t('quotes.languagePreference.card.radarIntense'), max: 0 },
  ]
  const valuesA = [a.noun, a.verb, a.adjective, a.modalParticle + a.interjection, a.adverb]
  const valuesB = [b.noun, b.verb, b.adjective, b.modalParticle + b.interjection, b.adverb]

  for (let i = 0; i < indicators.length; i++) {
    indicators[i].max = Math.max(valuesA[i], valuesB[i], 1) * 1.3
  }

  const textColor = isDark.value ? '#9ca3af' : '#6b7280'

  radarInstance.setOption(
    {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item' },
      legend: {
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 10, color: textColor },
        data: [memberA.value.name, memberB.value.name],
      },
      radar: {
        indicator: indicators,
        radius: '60%',
        center: ['50%', '50%'],
        splitArea: {
          areaStyle: {
            color: isDark.value
              ? ['rgba(255,255,255,0.02)', 'rgba(255,255,255,0.04)']
              : ['rgba(0,0,0,0.01)', 'rgba(0,0,0,0.03)'],
          },
        },
        axisName: { color: textColor, fontSize: 10 },
        splitLine: { lineStyle: { color: isDark.value ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' } },
        axisLine: { lineStyle: { color: isDark.value ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' } },
      },
      series: [
        {
          type: 'radar',
          data: [
            {
              value: valuesA,
              name: memberA.value.name,
              lineStyle: { color: '#3b82f6', width: 2 },
              areaStyle: { color: 'rgba(59,130,246,0.15)' },
              itemStyle: { color: '#3b82f6' },
              symbol: 'circle',
              symbolSize: 4,
            },
            {
              value: valuesB,
              name: memberB.value.name,
              lineStyle: { color: '#ec4899', width: 2 },
              areaStyle: { color: 'rgba(236,72,153,0.15)' },
              itemStyle: { color: '#ec4899' },
              symbol: 'circle',
              symbolSize: 4,
            },
          ],
        },
      ],
    },
    { notMerge: true }
  )
}

function handleResize() {
  radarInstance?.resize()
}
watch(
  () => props.data,
  () => updateRadar(),
  { deep: true }
)
watch(isDark, () => {
  radarInstance?.dispose()
  initRadar()
})
onMounted(() => {
  initRadar()
  window.addEventListener('resize', handleResize)
})
onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  radarInstance?.dispose()
})
</script>

<template>
  <ThemeCard data-capturable-card class="group/card relative isolate flex flex-col">
    <CardDecoration />
    <CardCaptureOverlay />
    <div v-if="memberA && memberB" class="relative z-10 flex flex-col h-full">
      <!-- 1. 主视觉区域：对比与口头禅 / 右侧雷达图 -->
      <div class="flex flex-col sm:flex-row items-center sm:items-start gap-6 px-6 pt-8 pb-4 sm:px-8">
        <!-- 左侧叙事区：对比大标题与口头禅列 -->
        <div class="w-full flex-1 min-w-0">
          <div class="flex items-center gap-x-2 sm:gap-x-3 mb-6 sm:mb-8">
            <span class="text-2xl sm:text-4xl font-black tracking-tight text-blue-600 dark:text-blue-400 truncate">
              {{ memberA.name }}
            </span>
            <span class="text-sm sm:text-lg font-black text-gray-300 dark:text-gray-600 italic px-1 sm:px-2 shrink-0">
              VS
            </span>
            <span class="text-2xl sm:text-4xl font-black tracking-tight text-pink-600 dark:text-pink-400 truncate">
              {{ memberB.name }}
            </span>
          </div>

          <div class="grid grid-cols-2 gap-4 sm:gap-10">
            <div v-for="(m, idx) in [memberA, memberB]" :key="m.memberId" class="flex flex-col gap-3">
              <div class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                {{ t('quotes.languagePreference.card.topCatchphrases') }}
              </div>
              <div class="flex flex-col gap-2.5">
                <div
                  v-for="(cp, cpIdx) in m.catchphrases.slice(0, 3)"
                  :key="cpIdx"
                  class="flex items-center gap-2 group"
                >
                  <span
                    class="text-xs sm:text-sm font-black font-mono opacity-40 transition-opacity group-hover:opacity-100"
                    :class="idx === 0 ? 'text-blue-600 dark:text-blue-400' : 'text-pink-600 dark:text-pink-400'"
                  >
                    #{{ cpIdx + 1 }}
                  </span>
                  <span
                    class="truncate text-sm sm:text-base font-bold text-gray-700 dark:text-gray-200 cursor-pointer hover:opacity-70 transition-opacity"
                    :title="cp.content"
                    @click="emit('wordClick', cp.content)"
                  >
                    「{{ truncate(cp.content, 12) }}」
                  </span>
                  <span class="shrink-0 text-[10px] sm:text-xs font-semibold tabular-nums text-gray-400/80">
                    ×{{ cp.count }}
                  </span>
                </div>
                <div v-if="m.catchphrases.length === 0" class="text-xs sm:text-sm font-medium text-gray-400">-</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧雷达图 -->
        <div class="hidden shrink-0 sm:block">
          <div ref="radarRef" style="width: 250px; height: 230px" class="-mt-4 sm:-mr-4" />
        </div>
      </div>

      <!-- 2. 底部合并指标卡（3 个） -->
      <div class="px-6 pb-6 pt-2 sm:px-8 mt-auto">
        <div class="mb-3 flex items-center justify-between">
          <span class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
            {{ t('quotes.languagePreference.card.languageProfiles') }}
          </span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div v-for="card in mergedCards" :key="card.title" class="flex min-w-0 flex-col p-4">
            <!-- Header -->
            <div class="mb-4 flex items-center gap-2.5">
              <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" :class="card.iconBgClass">
                <UIcon :name="card.icon" class="h-4 w-4" :class="card.iconColorClass" />
              </div>
              <span class="text-sm font-bold tracking-wide text-gray-900 dark:text-white">
                {{ card.title }}
              </span>
            </div>

            <!-- VS 数值 -->
            <div class="flex items-center justify-between mb-4 w-full">
              <div class="flex flex-col flex-1 min-w-0">
                <span class="truncate text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                  {{ card.leftName }}
                </span>
                <span class="truncate text-xl font-black font-mono leading-none" :class="card.valueClass">
                  {{ card.leftValue }}
                </span>
              </div>
              <div class="px-2 shrink-0">
                <span class="text-[10px] font-black text-gray-300 dark:text-gray-600 italic">VS</span>
              </div>
              <div class="flex flex-col flex-1 min-w-0 items-end text-right">
                <span class="truncate text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                  {{ card.rightName }}
                </span>
                <span class="truncate text-xl font-black font-mono leading-none" :class="card.valueClass">
                  {{ card.rightValue }}
                </span>
              </div>
            </div>

            <!-- Tags & Desc -->
            <div class="mt-auto pt-3 border-t border-gray-100 dark:border-white/5 flex flex-col">
              <template v-if="card.detail.kind === 'tags-vs'">
                <div class="flex items-start justify-between gap-2 mb-2 min-h-[24px]">
                  <div class="flex flex-1 flex-nowrap overflow-hidden gap-1">
                    <span
                      v-for="tag in card.detail.leftTags"
                      :key="tag"
                      class="shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-semibold font-mono bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400"
                    >
                      {{ tag }}
                    </span>
                    <span v-if="card.detail.leftTags.length === 0" class="text-[11px] text-gray-400">-</span>
                  </div>
                  <div class="flex flex-1 flex-nowrap overflow-hidden gap-1 justify-end">
                    <span
                      v-for="tag in card.detail.rightTags"
                      :key="tag"
                      class="shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-semibold font-mono bg-pink-50 text-pink-600 dark:bg-pink-500/10 dark:text-pink-400"
                    >
                      {{ tag }}
                    </span>
                    <span v-if="card.detail.rightTags.length === 0" class="text-[11px] text-gray-400">-</span>
                  </div>
                </div>
              </template>
              <template v-else-if="card.detail.kind === 'tags-single'">
                <div class="flex flex-nowrap overflow-hidden items-center gap-x-1.5 mb-2 min-h-[24px]">
                  <template v-for="(tag, idx) in card.detail.tags.slice(0, 6)" :key="tag.word">
                    <span
                      class="shrink-0 cursor-pointer text-[11px] font-bold transition-opacity hover:opacity-80"
                      :style="{ color: tag.color }"
                      @click="emit('wordClick', tag.word)"
                    >
                      {{ tag.word }}
                    </span>
                    <span
                      v-if="idx < card.detail.tags.slice(0, 6).length - 1"
                      class="shrink-0 text-gray-300 dark:text-gray-600 font-normal"
                    >
                      ·
                    </span>
                  </template>
                  <span v-if="card.detail.tags.length === 0" class="text-[11px] text-gray-400">-</span>
                </div>
              </template>

              <p class="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
                {{ card.desc }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- 水印 -->
      <div
        class="flex items-center justify-between px-6 pb-4 opacity-40 mix-blend-luminosity dark:opacity-30 sm:px-8 sm:pb-5"
      >
        <div class="flex items-center gap-1.5">
          <UIcon name="i-heroicons-chat-bubble-left-right-solid" class="h-3.5 w-3.5" />
          <span class="text-[10px] font-bold uppercase tracking-wider">ChatLab</span>
        </div>
        <span class="text-[9px] font-medium uppercase tracking-widest">
          {{ t('quotes.languagePreference.card.watermark') }}
        </span>
      </div>
    </div>
  </ThemeCard>
</template>
