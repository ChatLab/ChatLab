<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import * as echarts from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { ThemeCard } from '@/components/UI'
import { MessageType, getMessageTypeName } from './types'
import type { MessageTypeCount, TextStats } from './types'
import { queryLongMessageCount, queryDailyActivity } from './queries'
import type { TimeFilter } from '@openchatlab/shared-types'
import dayjs from 'dayjs'

echarts.use([PieChart, TooltipComponent, CanvasRenderer])

const { t } = useI18n()
const isDark = useDark()

const props = defineProps<{
  sessionId: string
  messageTypes: MessageTypeCount[]
  textStats: TextStats
  timeFilter?: TimeFilter
}>()

const totalMessages = computed(() => props.messageTypes.reduce((sum, item) => sum + item.count, 0))
const textCount = computed(() => props.messageTypes.find((m) => m.type === MessageType.TEXT)?.count ?? 0)

const mediaRatio = computed(() => {
  if (totalMessages.value === 0) return 0
  const nonText = totalMessages.value - textCount.value
  return Math.round((nonText / totalMessages.value) * 100)
})

const shortRatio = computed(() => {
  if (props.textStats.textCount === 0) return 0
  return Math.round((props.textStats.shortCount / props.textStats.textCount) * 100)
})

// 日期范围
const dateRange = ref({ first: '', last: '' })

async function loadDateRange() {
  if (!props.sessionId) return
  try {
    const daily = await queryDailyActivity(props.sessionId, props.timeFilter)
    if (daily.length > 0) {
      const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date))
      dateRange.value = {
        first: dayjs(sorted[0].date).format('YYYY/MM/DD'),
        last: dayjs(sorted[sorted.length - 1].date).format('YYYY/MM/DD'),
      }
    }
  } catch {
    // ignore
  }
}

// 非文字类型明细（只列出数量>0的）
function getTypeCount(type: MessageType): number {
  return props.messageTypes.find((m) => m.type === type)?.count ?? 0
}

const nonTextItems = computed(() =>
  [
    {
      label: t('views.message.typeCard.nonTextImage'),
      count: getTypeCount(MessageType.IMAGE),
      unit: t('views.message.typeCard.unitImage'),
    },
    {
      label: t('views.message.typeCard.nonTextEmoji'),
      count: getTypeCount(MessageType.EMOJI),
      unit: t('views.message.typeCard.unitEmoji'),
    },
    {
      label: t('views.message.typeCard.nonTextVoice'),
      count: getTypeCount(MessageType.VOICE),
      unit: t('views.message.typeCard.unitVoice'),
    },
    {
      label: t('views.message.typeCard.nonTextVideo'),
      count: getTypeCount(MessageType.VIDEO),
      unit: t('views.message.typeCard.unitVideo'),
    },
    {
      label: t('views.message.typeCard.nonTextFile'),
      count: getTypeCount(MessageType.FILE),
      unit: t('views.message.typeCard.unitFile'),
    },
    {
      label: t('views.message.typeCard.nonTextLink'),
      count: getTypeCount(MessageType.LINK),
      unit: t('views.message.typeCard.unitLink'),
    },
  ].filter((m) => m.count > 0)
)

// 小作文阈值可调
const essayThreshold = ref(30)
const essayCount = ref(0)
const isEssayLoading = ref(false)

const essayThresholdOptions = [
  { label: '20', value: 20 },
  { label: '30', value: 30 },
  { label: '50', value: 50 },
  { label: '80', value: 80 },
  { label: '100', value: 100 },
]

const essayThresholdModel = computed({
  get: () => essayThreshold.value,
  set: (val: number) => {
    if (essayThreshold.value === val) return
    essayThreshold.value = val
    loadEssayCount()
  },
})

async function loadEssayCount() {
  if (!props.sessionId) return
  isEssayLoading.value = true
  try {
    essayCount.value = await queryLongMessageCount(props.sessionId, props.timeFilter, essayThreshold.value)
  } catch (error) {
    console.error('[chart-message] Failed to load essay count:', error)
  } finally {
    isEssayLoading.value = false
  }
}

watch(
  () => [props.sessionId, props.timeFilter],
  () => {
    loadEssayCount()
    loadDateRange()
  },
  { immediate: true, deep: true }
)

// 指标卡片
interface MetricItem {
  icon: string
  label: string
  value: string
  subtext: string
  colorClass: string
  slot?: string
}

const metricItems = computed<MetricItem[]>(() => [
  {
    icon: 'i-heroicons-pencil-square',
    label: t('views.message.profile.textExpression'),
    value: t('views.message.profile.avgLengthUnit', { count: props.textStats.avgLength || 0 }),
    subtext:
      props.textStats.maxLength > 0
        ? t('views.message.profile.textExpressionDesc', { count: props.textStats.maxLength })
        : '',
    colorClass: 'text-violet-600 dark:text-violet-400',
  },
  {
    icon: 'i-heroicons-chat-bubble-bottom-center-text',
    label: t('views.message.profile.shortMaster'),
    value: `${shortRatio.value}%`,
    subtext: t('views.message.profile.shortMasterDesc', { count: props.textStats.shortCount }),
    colorClass: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    icon: 'i-heroicons-document-text',
    label: t('views.message.profile.essayLover'),
    value: essayCount.value.toLocaleString(),
    subtext: t('views.message.profile.essayLoverDesc', { threshold: essayThreshold.value }),
    colorClass: 'text-indigo-600 dark:text-indigo-400',
    slot: 'essay-threshold',
  },
  {
    icon: 'i-heroicons-photo',
    label: t('views.message.profile.mediaRichness'),
    value: `${mediaRatio.value}%`,
    subtext:
      nonTextItems.value
        .slice(0, 3)
        .map((m) => `${m.label} ${m.count}`)
        .join(' · ') || '-',
    colorClass: 'text-pink-600 dark:text-pink-400',
  },
])

// 环形图
const donutRef = ref<HTMLElement | null>(null)
let donutInstance: echarts.ECharts | null = null

const typeColors = [
  '#6366f1',
  '#ec4899',
  '#f97316',
  '#22c55e',
  '#06b6d4',
  '#8b5cf6',
  '#f43f5e',
  '#eab308',
  '#14b8a6',
  '#3b82f6',
]

const donutData = computed(() => {
  const sorted = [...props.messageTypes].sort((a, b) => b.count - a.count)
  return sorted.slice(0, 8).map((item, i) => ({
    name: getMessageTypeName(item.type, t),
    value: item.count,
    itemStyle: { color: typeColors[i % typeColors.length] },
  }))
})

function initDonut() {
  if (!donutRef.value) return
  donutInstance = echarts.init(donutRef.value, undefined, { renderer: 'canvas' })
  updateDonut()
}

function updateDonut() {
  if (!donutInstance) return
  donutInstance.setOption(
    {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      series: [
        {
          type: 'pie',
          radius: ['50%', '78%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          padAngle: 2,
          itemStyle: { borderRadius: 4 },
          label: { show: false },
          emphasis: { label: { show: false }, scaleSize: 4 },
          data: donutData.value,
        },
      ],
    },
    { notMerge: true }
  )
}

function handleResize() {
  donutInstance?.resize()
}

watch(
  () => props.messageTypes,
  () => updateDonut()
)

watch(isDark, () => {
  donutInstance?.dispose()
  initDonut()
})

onMounted(() => {
  initDonut()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  donutInstance?.dispose()
})
</script>

<template>
  <ThemeCard variant="elevated" decorative class="flex flex-col">
    <!-- 主视觉区域 -->
    <div class="relative z-10 px-6 pt-8 pb-4 sm:px-8">
      <div class="flex items-center gap-6 sm:gap-10">
        <!-- 左侧：叙事文字 -->
        <div class="min-w-0 flex-1">
          <div class="flex flex-col text-[15px] leading-relaxed text-gray-600 dark:text-gray-300">
            <!-- 日期范围 -->
            <p v-if="dateRange.first" class="mb-2 text-sm font-medium tracking-wide text-gray-500 dark:text-gray-400">
              {{ dateRange.first }} – {{ dateRange.last }}
            </p>

            <!-- 第一行：总消息数 -->
            <div class="mb-4 flex min-w-0 flex-wrap items-baseline gap-2">
              <span class="text-xl font-medium text-gray-700 dark:text-gray-300">
                {{ t('views.message.profile.heroLine1Prefix') }}
              </span>
              <span class="font-black text-5xl tracking-tight text-gray-900 dark:text-white">
                {{ totalMessages.toLocaleString() }}
              </span>
              <span class="text-xl font-medium text-gray-700 dark:text-gray-300">
                {{ t('views.message.profile.heroLine1Suffix') }}
              </span>
            </div>

            <!-- 第二行：非文字类型明细 -->
            <div
              v-if="nonTextItems.length > 0"
              class="flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-1.5"
            >
              <span class="text-base font-medium text-gray-600 dark:text-gray-300">
                {{ t('views.message.typeCard.nonTextPrefix') }}
              </span>
              <span
                v-for="item in nonTextItems"
                :key="item.label"
                class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700 dark:bg-white/10 dark:text-gray-200"
              >
                <span class="font-bold tabular-nums text-pink-500 dark:text-pink-400">
                  {{ item.count.toLocaleString() }}
                </span>
                <span>{{ item.unit }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- 右侧：环形图 -->
        <div class="flex shrink-0 flex-col items-center">
          <div class="mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">
            {{ t('views.message.profile.typeDistribution') }}
          </div>
          <div ref="donutRef" style="width: 130px; height: 130px" />
        </div>
      </div>
    </div>

    <!-- 指标卡片 -->
    <div class="relative z-10 px-6 pb-6 pt-4 sm:px-8">
      <div class="mb-3 flex items-center justify-between">
        <span class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
          Type Profile
        </span>
      </div>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div
          v-for="item in metricItems"
          :key="item.icon + item.label"
          class="flex items-start gap-2 rounded-lg bg-white/60 p-2.5 ring-1 ring-gray-900/5 dark:bg-white/5 dark:ring-white/10"
        >
          <UIcon :name="item.icon" class="mt-0.5 h-3.5 w-3.5 shrink-0" :class="item.colorClass" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-1">
              <div class="truncate font-mono text-sm font-black leading-tight tabular-nums" :class="item.colorClass">
                {{ item.value }}
              </div>
              <USelect
                v-if="item.slot === 'essay-threshold'"
                v-model="essayThresholdModel"
                :items="essayThresholdOptions"
                value-key="value"
                size="xs"
                class="relative z-120 w-16 shrink-0"
                :ui="{ content: 'z-[121]' }"
                :disabled="isEssayLoading"
              />
            </div>
            <div class="mt-0.5 truncate text-[10px] font-medium text-gray-500 dark:text-gray-400">
              {{ item.label }}
            </div>
            <div class="mt-0.5 truncate text-[9px] text-gray-400 dark:text-gray-500">
              {{ item.subtext }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 水印 -->
    <div
      class="relative z-10 flex items-center justify-between px-6 pb-4 opacity-40 mix-blend-luminosity dark:opacity-30 sm:px-8 sm:pb-5"
    >
      <div class="flex items-center gap-1.5">
        <UIcon name="i-heroicons-chat-bubble-left-right-solid" class="h-3.5 w-3.5" />
        <span class="text-[10px] font-bold uppercase tracking-wider">ChatLab</span>
      </div>
      <span class="text-[9px] font-medium uppercase tracking-widest">
        {{ t('views.message.typeCard.watermark') }}
      </span>
    </div>
  </ThemeCard>
</template>
