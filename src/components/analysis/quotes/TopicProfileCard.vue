<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import { CardCaptureOverlay, CardDecoration, ThemeCard } from '@/components/UI'
import type { WordFrequencyItem, PosTagStat } from './topicProfileTypes'
import type { TimeFilter } from '@openchatlab/shared-types'

const EChartWordcloud = defineAsyncComponent(() => import('@/components/charts/EChartWordcloud.vue'))

const { t } = useI18n()

const props = defineProps<{
  totalMessages: number
  totalWords: number
  uniqueWords: number
  topWords: WordFrequencyItem[]
  topicWords?: WordFrequencyItem[]
  posTagStats?: PosTagStat[]
  timeFilter?: TimeFilter
}>()

const emit = defineEmits<{
  wordClick: [word: string]
}>()

// 日期范围展示（与消息画像卡保持一致的格式）
const dateRangeText = computed(() => {
  const { startTs, endTs } = props.timeFilter ?? {}
  if (startTs && endTs) {
    return `${dayjs(startTs * 1000).format('YYYY/MM/DD')} – ${dayjs(endTs * 1000).format('YYYY/MM/DD')}`
  }
  return ''
})

// Top 5 话题关键词（优先使用话题词性过滤数据）
const topKeywords = computed(() => {
  const source = props.topicWords?.length ? props.topicWords : props.topWords
  return source.slice(0, 5)
})

// 迷你词云数据（优先使用话题词性过滤数据，回退到 topWords）
const miniWordcloudData = computed(() => {
  const source = props.topicWords?.length ? props.topicWords : props.topWords
  return {
    words: source.slice(0, 50).map((w) => ({
      word: w.word,
      count: w.count,
      percentage: w.percentage,
    })),
  }
})

// 词汇丰富度百分比
const richnessPercent = computed(() => {
  if (props.totalWords === 0) return 0
  return Math.round((props.uniqueWords / props.totalWords) * 100)
})

// 聊天风格（基于词性分布推导）
const chatStyle = computed(() => {
  if (!props.posTagStats?.length) {
    return {
      key: 'Balanced',
      label: t('quotes.topicProfile.styleBalanced'),
      desc: t('quotes.topicProfile.styleBalancedDesc'),
      icon: 'i-heroicons-scale-solid',
      colorClass: 'text-cyan-600 dark:text-cyan-400',
    }
  }

  const statsMap = new Map(props.posTagStats.map((s) => [s.tag, s.count]))
  const nounCount =
    (statsMap.get('n') || 0) + (statsMap.get('ns') || 0) + (statsMap.get('nt') || 0) + (statsMap.get('nz') || 0)
  const verbCount = (statsMap.get('v') || 0) + (statsMap.get('vn') || 0) + (statsMap.get('vd') || 0)
  const adjCount = (statsMap.get('a') || 0) + (statsMap.get('ad') || 0) + (statsMap.get('an') || 0)

  const total = nounCount + verbCount + adjCount
  if (total === 0) {
    return {
      key: 'Balanced',
      label: t('quotes.topicProfile.styleBalanced'),
      desc: t('quotes.topicProfile.styleBalancedDesc'),
      icon: 'i-heroicons-scale-solid',
      colorClass: 'text-cyan-600 dark:text-cyan-400',
    }
  }

  const nounRatio = nounCount / total
  const verbRatio = verbCount / total
  const adjRatio = adjCount / total

  if (nounRatio > 0.5) {
    return {
      key: 'Encyclopedia',
      label: t('quotes.topicProfile.styleEncyclopedia'),
      desc: t('quotes.topicProfile.styleEncyclopediaDesc'),
      icon: 'i-heroicons-book-open-solid',
      colorClass: 'text-indigo-600 dark:text-indigo-400',
    }
  }
  if (verbRatio > 0.45) {
    return {
      key: 'Action',
      label: t('quotes.topicProfile.styleAction'),
      desc: t('quotes.topicProfile.styleActionDesc'),
      icon: 'i-heroicons-rocket-launch-solid',
      colorClass: 'text-orange-600 dark:text-orange-400',
    }
  }
  if (adjRatio > 0.3) {
    return {
      key: 'Expressive',
      label: t('quotes.topicProfile.styleExpressive'),
      desc: t('quotes.topicProfile.styleExpressiveDesc'),
      icon: 'i-heroicons-paint-brush-solid',
      colorClass: 'text-pink-600 dark:text-pink-400',
    }
  }

  return {
    key: 'Balanced',
    label: t('quotes.topicProfile.styleBalanced'),
    desc: t('quotes.topicProfile.styleBalancedDesc'),
    icon: 'i-heroicons-scale-solid',
    colorClass: 'text-cyan-600 dark:text-cyan-400',
  }
})

// 表达风格（基于高频词平均字符长度推导）
const expressionStyle = computed(() => {
  if (props.topWords.length === 0) {
    return {
      label: t('quotes.topicProfile.expressionMixed'),
      desc: t('quotes.topicProfile.expressionMixedDesc'),
      icon: 'i-heroicons-chat-bubble-left-right-solid',
      colorClass: 'text-emerald-600 dark:text-emerald-400',
    }
  }

  const totalLen = props.topWords.reduce((sum, w) => sum + w.word.length * w.count, 0)
  const totalCount = props.topWords.reduce((sum, w) => sum + w.count, 0)
  const avgLen = totalLen / totalCount

  if (avgLen < 2.5) {
    return {
      label: t('quotes.topicProfile.expressionCasual'),
      desc: t('quotes.topicProfile.expressionCasualDesc'),
      icon: 'i-heroicons-face-smile-solid',
      colorClass: 'text-amber-600 dark:text-amber-400',
    }
  }
  if (avgLen > 3.5) {
    return {
      label: t('quotes.topicProfile.expressionFormal'),
      desc: t('quotes.topicProfile.expressionFormalDesc'),
      icon: 'i-heroicons-academic-cap-solid',
      colorClass: 'text-violet-600 dark:text-violet-400',
    }
  }

  return {
    label: t('quotes.topicProfile.expressionMixed'),
    desc: t('quotes.topicProfile.expressionMixedDesc'),
    icon: 'i-heroicons-chat-bubble-left-right-solid',
    colorClass: 'text-emerald-600 dark:text-emerald-400',
  }
})

// 指标卡数据
interface MetricItem {
  icon: string
  label: string
  value: string
  subtext: string
  colorClass: string
}

const metricItems = computed<MetricItem[]>(() => [
  {
    icon: 'i-heroicons-fire-solid',
    label: t('quotes.topicProfile.hotTopic'),
    value: topKeywords.value[0]?.word ?? '-',
    subtext: topKeywords.value[0] ? t('quotes.topicProfile.hotTopicDesc', { count: topKeywords.value[0].count }) : '',
    colorClass: 'text-red-600 dark:text-red-400',
  },
  {
    icon: 'i-heroicons-sparkles-solid',
    label: t('quotes.topicProfile.richness'),
    value: t('quotes.topicProfile.richnessValue', { value: richnessPercent.value }),
    subtext: t('quotes.topicProfile.richnessDesc', {
      unique: props.uniqueWords.toLocaleString(),
      total: props.totalWords.toLocaleString(),
    }),
    colorClass: 'text-blue-600 dark:text-blue-400',
  },
  {
    icon: chatStyle.value.icon,
    label: t('quotes.topicProfile.chatStyle'),
    value: chatStyle.value.label,
    subtext: chatStyle.value.desc,
    colorClass: chatStyle.value.colorClass,
  },
  {
    icon: expressionStyle.value.icon,
    label: t('quotes.topicProfile.expressionStyle'),
    value: expressionStyle.value.label,
    subtext: expressionStyle.value.desc,
    colorClass: expressionStyle.value.colorClass,
  },
])

const KEYWORD_COLORS = ['#6366f1', '#ec4899', '#f97316', '#22c55e', '#3b82f6', '#8b5cf6', '#14b8a6', '#f43f5e']
</script>

<template>
  <ThemeCard data-capturable-card class="group/card relative isolate flex flex-col">
    <CardDecoration />
    <CardCaptureOverlay />
    <!-- 主视觉区域 -->
    <div class="relative z-10 px-6 pt-8 pb-4 sm:px-8">
      <div class="flex items-center gap-6 sm:gap-10">
        <!-- 左侧：叙事文字（四行布局） -->
        <div class="min-w-0 flex-1">
          <div class="flex flex-col gap-2 text-[15px] leading-relaxed text-gray-600 dark:text-gray-300">
            <p v-if="dateRangeText" class="mb-0 text-sm font-medium tracking-wide text-gray-500 dark:text-gray-400">
              {{ dateRangeText }}
            </p>

            <!-- 第一行：消息总数 -->
            <div class="flex items-baseline gap-x-1.5">
              <span class="text-xl font-medium text-gray-700 dark:text-gray-300">
                {{ t('quotes.topicProfile.heroPrefix') }}
              </span>
              <span class="font-black text-5xl tracking-tight text-gray-900 dark:text-white">
                {{ totalMessages.toLocaleString() }}
              </span>
              <span class="text-xl font-medium text-gray-700 dark:text-gray-300">
                {{ t('quotes.topicProfile.heroMiddle') }}
              </span>
            </div>

            <!-- 第二行：独特词汇数 -->
            <div class="flex items-baseline gap-x-1.5">
              <span class="text-xl font-medium text-gray-700 dark:text-gray-300">
                {{ t('quotes.topicProfile.heroMiddleSecond') }}
              </span>
              <span class="font-black text-3xl text-pink-500 dark:text-pink-400">
                {{ uniqueWords.toLocaleString() }}
              </span>
              <span class="text-xl font-medium text-gray-700 dark:text-gray-300">
                {{ t('quotes.topicProfile.heroSuffix') }}
              </span>
            </div>

            <!-- 第三行：热门话题 -->
            <div v-if="topKeywords.length > 0" class="mt-1 flex items-baseline flex-wrap gap-x-1.5 gap-y-1">
              <span class="text-base font-medium text-gray-600 dark:text-gray-300">
                {{ t('quotes.topicProfile.topTopicsPrefix') }}
              </span>
              <template v-for="(kw, idx) in topKeywords" :key="kw.word">
                <span
                  class="cursor-pointer font-bold text-xl transition-opacity hover:opacity-70"
                  :style="{ color: KEYWORD_COLORS[idx % KEYWORD_COLORS.length] }"
                  @click="emit('wordClick', kw.word)"
                >
                  {{ kw.word }}
                </span>
                <span v-if="idx < topKeywords.length - 1" class="text-gray-400">·</span>
              </template>
            </div>
          </div>
        </div>

        <!-- 右侧：迷你词云 -->
        <div v-if="miniWordcloudData.words.length > 0" class="hidden shrink-0 overflow-hidden rounded-lg sm:block">
          <div class="relative" style="width: 360px; height: 220px">
            <EChartWordcloud
              :data="miniWordcloudData"
              height="100%"
              :max-words="50"
              :size-scale="0.8"
              :draw-out-of-bound="true"
              shape="rectangle"
              color-scheme="default"
              @word-click="(word: string) => emit('wordClick', word)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 指标卡片 -->
    <div class="relative z-10 px-6 pb-6 pt-4 sm:px-8">
      <div class="mb-3 flex items-center justify-between">
        <span class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
          Topic Profile
        </span>
      </div>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div v-for="item in metricItems" :key="item.label" class="flex min-w-0 items-start gap-2 px-2.5 py-2">
          <UIcon :name="item.icon" class="mt-0.5 h-3.5 w-3.5 shrink-0" :class="item.colorClass" />
          <div class="min-w-0 flex-1">
            <div class="truncate font-mono text-sm font-black leading-tight tabular-nums" :class="item.colorClass">
              {{ item.value }}
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
        {{ t('quotes.topicProfile.watermark') }}
      </span>
    </div>
  </ThemeCard>
</template>
