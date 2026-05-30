<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { EChartPie, EChartBar } from '@/components/charts'
import type { EChartPieData, EChartBarData } from '@/components/charts'
import { SectionCard, LoadingState } from '@/components/UI'
import {
  queryMessageTypes,
  queryLengthDistribution,
  queryTextStats,
  queryLongMessageCount,
  queryTextLengthPercentiles,
} from './queries'
import { getMessageTypeName } from './types'
import type { MessageTypeCount, TextStats, TextLengthPercentiles } from './types'
import TypeProfileCard from './TypeProfileCard.vue'
import type { TimeFilter } from '@openchatlab/shared-types'

const props = defineProps<{
  sessionId: string
  sessionName?: string
  timeFilter?: TimeFilter
}>()

const { t } = useI18n()

const isLoading = ref(true)
const messageTypes = ref<MessageTypeCount[]>([])
const lengthDetail = ref<Array<{ len: number; count: number }>>([])
const lengthGrouped = ref<Array<{ range: string; count: number }>>([])
const textStats = ref<TextStats>({ textCount: 0, avgLength: 0, maxLength: 0, shortCount: 0 })
const percentiles = ref<TextLengthPercentiles>({ p25: 0, p50: 0, p75: 0, p90: 0 })
const essayCount = ref(0)

// 消息类型饼图数据
const typeChartData = computed<EChartPieData>(() => {
  const sorted = [...messageTypes.value].sort((a, b) => b.count - a.count)
  return {
    labels: sorted.map((item) => getMessageTypeName(item.type, t)),
    values: sorted.map((item) => item.count),
  }
})

// 消息类型摘要
const typeSummary = computed(() => {
  const total = messageTypes.value.reduce((sum, item) => sum + item.count, 0)
  const sorted = [...messageTypes.value].sort((a, b) => b.count - a.count)
  return sorted.map((item) => ({
    name: getMessageTypeName(item.type, t),
    count: item.count,
    percentage: total > 0 ? Math.round((item.count / total) * 100) : 0,
  }))
})

const typeColors = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
]

function getTypeColor(index: number): string {
  return typeColors[index % typeColors.length]
}

// 消息长度详细分布
const lengthDetailChartData = computed<EChartBarData>(() => ({
  labels: lengthDetail.value.map((d) => String(d.len)),
  values: lengthDetail.value.map((d) => d.count),
}))

// 消息长度分组分布
const lengthGroupedChartData = computed<EChartBarData>(() => ({
  labels: lengthGrouped.value.map((d) => d.range),
  values: lengthGrouped.value.map((d) => d.count),
}))

// 文字深度指标
const shortRatio = computed(() => {
  if (textStats.value.textCount === 0) return 0
  return Math.round((textStats.value.shortCount / textStats.value.textCount) * 100)
})

async function loadData() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    const [types, lengthData, txtStats, pctiles, essays] = await Promise.all([
      queryMessageTypes(props.sessionId, props.timeFilter),
      queryLengthDistribution(props.sessionId, props.timeFilter),
      queryTextStats(props.sessionId, props.timeFilter),
      queryTextLengthPercentiles(props.sessionId, props.timeFilter),
      queryLongMessageCount(props.sessionId, props.timeFilter, 30),
    ])

    messageTypes.value = types
    lengthDetail.value = lengthData.detail
    lengthGrouped.value = lengthData.grouped
    textStats.value = txtStats
    percentiles.value = pctiles
    essayCount.value = essays
  } catch (error) {
    console.error('[chart-message] Failed to load type analysis data:', error)
  } finally {
    isLoading.value = false
  }
}

watch(
  () => [props.sessionId, props.timeFilter],
  () => loadData(),
  { immediate: true, deep: true }
)
</script>

<template>
  <div :class="isLoading ? 'h-full' : ''">
    <LoadingState v-if="isLoading" variant="page" :text="t('common.loading')" />

    <div v-else class="main-content mx-auto max-w-[920px] space-y-6 p-6">
      <!-- 类型画像卡 -->
      <TypeProfileCard
        v-if="messageTypes.length > 0"
        :session-id="sessionId"
        :message-types="messageTypes"
        :text-stats="textStats"
        :time-filter="timeFilter"
      />

      <!-- 消息类型分布 -->
      <SectionCard :title="t('views.message.typeDistribution')" :show-divider="false">
        <div class="p-5">
          <div v-if="typeChartData.values.length > 0" class="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-center">
            <div>
              <EChartPie :data="typeChartData" :height="280" :show-legend="false" />
            </div>
            <div>
              <div class="space-y-3">
                <div v-for="(item, index) in typeSummary" :key="index" class="flex items-center gap-3">
                  <div class="h-3 w-3 shrink-0 rounded-full" :style="{ backgroundColor: getTypeColor(index) }" />
                  <div class="min-w-20 shrink-0 text-sm text-gray-700 dark:text-gray-300">{{ item.name }}</div>
                  <div class="flex-1">
                    <div class="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                      <div
                        class="h-full rounded-full transition-all"
                        :style="{ width: `${item.percentage}%`, backgroundColor: getTypeColor(index) }"
                      />
                    </div>
                  </div>
                  <div class="shrink-0 text-right">
                    <span class="text-sm font-medium text-gray-900 dark:text-white">
                      {{ item.count.toLocaleString() }}
                    </span>
                    <span class="ml-1 text-xs text-gray-400">({{ item.percentage }}%)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="flex h-48 items-center justify-center text-gray-400">
            {{ t('views.message.noData') }}
          </div>
        </div>
      </SectionCard>

      <!-- 文字深度分析 -->
      <SectionCard :title="t('views.message.typeAnalysis.textDepthTitle')" :show-divider="false">
        <div class="p-5">
          <div class="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
              <div class="font-mono text-xl font-bold text-gray-900 dark:text-white">
                {{ textStats.textCount.toLocaleString() }}
              </div>
              <div class="mt-1 text-xs text-gray-500">{{ t('views.message.typeAnalysis.textTotal') }}</div>
            </div>
            <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
              <div class="font-mono text-xl font-bold text-indigo-600 dark:text-indigo-400">
                {{ textStats.avgLength || 0 }}
              </div>
              <div class="mt-1 text-xs text-gray-500">{{ t('views.message.typeAnalysis.avgLength') }}</div>
            </div>
            <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
              <div class="font-mono text-xl font-bold text-pink-600 dark:text-pink-400">
                {{ percentiles.p50 }}
              </div>
              <div class="mt-1 text-xs text-gray-500">{{ t('views.message.typeAnalysis.medianLength') }}</div>
            </div>
            <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
              <div class="font-mono text-xl font-bold text-emerald-600 dark:text-emerald-400">
                {{ textStats.maxLength }}
              </div>
              <div class="mt-1 text-xs text-gray-500">{{ t('views.message.typeAnalysis.maxLength') }}</div>
            </div>
          </div>

          <!-- 百分位条 -->
          <div class="mb-5 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <div class="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
              {{ t('views.message.typeAnalysis.percentiles') }}
            </div>
            <div class="flex items-center gap-4 text-sm">
              <div class="flex items-center gap-1.5">
                <span class="text-gray-500">P25</span>
                <span class="font-mono font-medium text-gray-900 dark:text-white">{{ percentiles.p25 }}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-gray-500">P50</span>
                <span class="font-mono font-medium text-gray-900 dark:text-white">{{ percentiles.p50 }}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-gray-500">P75</span>
                <span class="font-mono font-medium text-gray-900 dark:text-white">{{ percentiles.p75 }}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-gray-500">P90</span>
                <span class="font-mono font-medium text-gray-900 dark:text-white">{{ percentiles.p90 }}</span>
              </div>
            </div>

            <div class="mt-3 grid grid-cols-3 gap-3 text-xs">
              <div>
                <span class="text-gray-500">{{ t('views.message.typeAnalysis.shortMessages') }}</span>
                <span class="ml-1 font-medium text-emerald-600 dark:text-emerald-400">{{ shortRatio }}%</span>
                <span class="text-gray-400">({{ textStats.shortCount }})</span>
              </div>
              <div>
                <span class="text-gray-500">{{ t('views.message.typeAnalysis.essayMessages') }}</span>
                <span class="ml-1 font-medium text-indigo-600 dark:text-indigo-400">{{ essayCount }}</span>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <!-- 消息长度分布 -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard :title="t('views.message.lengthDetailTitle')" :show-divider="false">
          <template #headerRight>
            <span class="text-xs text-gray-400">{{ t('views.message.lengthDetailHint') }}</span>
          </template>
          <div class="p-5">
            <EChartBar
              v-if="lengthDetailChartData.values.some((v) => v > 0)"
              :data="lengthDetailChartData"
              :height="200"
            />
            <div v-else class="flex h-48 items-center justify-center text-gray-400">
              {{ t('views.message.noTextMessages') }}
            </div>
          </div>
        </SectionCard>

        <SectionCard :title="t('views.message.lengthGroupedTitle')" :show-divider="false">
          <template #headerRight>
            <span class="text-xs text-gray-400">{{ t('views.message.lengthGroupedHint') }}</span>
          </template>
          <div class="p-5">
            <EChartBar
              v-if="lengthGroupedChartData.values.some((v) => v > 0)"
              :data="lengthGroupedChartData"
              :height="200"
            />
            <div v-else class="flex h-48 items-center justify-center text-gray-400">
              {{ t('views.message.noTextMessages') }}
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  </div>
</template>
