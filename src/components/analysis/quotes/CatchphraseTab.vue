<script setup lang="ts">
import { ref, watch, computed, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CatchphraseAnalysis } from '@/types/analysis'
const EChartWordcloud = defineAsyncComponent(() => import('@/components/charts/EChartWordcloud.vue'))
import type { EChartWordcloudData } from '@/components/charts'
import { LoadingState, EmptyState, UITabs } from '@/components/UI'
import { useLayoutStore } from '@/stores/layout'

const { t } = useI18n()
const layoutStore = useLayoutStore()

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const catchphraseAnalysis = ref<CatchphraseAnalysis | null>(null)
const isLoading = ref(false)
const viewMode = ref<'list' | 'wordcloud'>('list')
const topN = ref(30)

const viewModeOptions = computed(() => [
  { label: t('quotes.catchphrase.viewMode.list'), value: 'list' },
  { label: t('quotes.catchphrase.viewMode.wordcloud'), value: 'wordcloud' },
])

const topNOptions = [
  { label: '10', value: 10 },
  { label: '30', value: 30 },
  { label: '50', value: 50 },
  { label: '100', value: 100 },
]

const hasData = computed(() => catchphraseAnalysis.value && catchphraseAnalysis.value.members.length > 0)

// 按 topN 截取后的成员数据
const displayMembers = computed(() => {
  if (!catchphraseAnalysis.value) return []
  const n = topN.value
  console.log('[CatchphraseTab] displayMembers recompute, topN:', n, 'type:', typeof n)
  return catchphraseAnalysis.value.members.map((member) => {
    const sliced = member.catchphrases.slice(0, n)
    console.log('[CatchphraseTab]', member.name, 'total:', member.catchphrases.length, 'display:', sliced.length)
    return { ...member, catchphrases: sliced }
  })
})

// 每个成员独立的词云数据
const memberWordclouds = computed(() =>
  displayMembers.value.map((member) => ({
    name: member.name,
    data: {
      words: member.catchphrases.map((p) => ({
        word: p.content,
        count: p.count,
      })),
    } as EChartWordcloudData,
  }))
)

const rankStyles = [
  {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    text: 'text-amber-700 dark:text-amber-400',
    badge: 'bg-amber-100 dark:bg-amber-800/40 text-amber-600 dark:text-amber-300',
  },
  {
    bg: 'bg-slate-50 dark:bg-slate-800/40',
    text: 'text-slate-600 dark:text-slate-300',
    badge: 'bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400',
  },
  {
    bg: 'bg-orange-50 dark:bg-orange-900/15',
    text: 'text-orange-600 dark:text-orange-400',
    badge: 'bg-orange-100 dark:bg-orange-800/30 text-orange-500 dark:text-orange-300',
  },
]

function getRankStyle(index: number) {
  if (index < rankStyles.length) return rankStyles[index]
  return {
    bg: 'bg-gray-50 dark:bg-gray-800/30',
    text: 'text-gray-600 dark:text-gray-400',
    badge: 'bg-gray-100 dark:bg-gray-700/40 text-gray-500 dark:text-gray-400',
  }
}

function truncateContent(content: string, maxLength = 20): string {
  if (content.length <= maxLength) return content
  return content.slice(0, maxLength) + '...'
}

async function loadCatchphraseAnalysis() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    catchphraseAnalysis.value = await window.chatApi.getCatchphraseAnalysis(props.sessionId, props.timeFilter)
    console.log('[CatchphraseTab] API result: members:', catchphraseAnalysis.value?.members.length, 'per-member catchphrases:', catchphraseAnalysis.value?.members.map((m) => ({ name: m.name, count: m.catchphrases.length })))
  } catch (error) {
    console.error('Failed to load catchphrase analysis:', error)
  } finally {
    isLoading.value = false
  }
}

function handleWordClick(word: string) {
  layoutStore.openChatRecordDrawer({
    keywords: [word],
  })
}

watch(topN, (newVal, oldVal) => {
  console.log('[CatchphraseTab] topN changed:', oldVal, '->', newVal, 'type:', typeof newVal)
})

watch(
  () => [props.sessionId, props.timeFilter],
  () => {
    loadCatchphraseAnalysis()
  },
  { immediate: true, deep: true }
)
</script>

<template>
  <div class="main-content mx-auto max-w-6xl py-6">
    <!-- 加载中 -->
    <LoadingState v-if="isLoading" :text="t('quotes.catchphrase.loading')" />

    <!-- 空状态 -->
    <EmptyState v-else-if="!hasData" :text="t('quotes.catchphrase.empty.title')" />

    <!-- 主内容 -->
    <template v-else>
      <!-- 工具栏（全部靠右） -->
      <div class="mb-4 flex items-center justify-end gap-4">
        <span class="text-xs text-gray-500 dark:text-gray-400">{{ t('quotes.catchphrase.topN') }}</span>
        <UITabs v-model="topN" size="xs" :items="topNOptions" />
        <div class="h-4 w-px bg-gray-200 dark:bg-gray-700" />
        <UITabs v-model="viewMode" size="xs" :items="viewModeOptions" />
      </div>

      <!-- 列表视图 -->
      <div v-if="viewMode === 'list'" class="grid grid-cols-2 gap-6">
        <div v-for="member in displayMembers" :key="member.memberId">
          <div class="mb-3 text-center">
            <span class="text-base font-semibold text-gray-900 dark:text-white">{{ member.name }}</span>
          </div>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="(phrase, index) in member.catchphrases"
              :key="index"
              class="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 transition-opacity hover:opacity-75"
              :class="getRankStyle(index).bg"
              :title="phrase.content"
              @click="handleWordClick(phrase.content)"
            >
              <span
                v-if="index < 3"
                class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                :class="getRankStyle(index).badge"
              >
                {{ index + 1 }}
              </span>
              <span class="text-sm font-medium" :class="getRankStyle(index).text">
                {{ truncateContent(phrase.content) }}
              </span>
              <span class="text-xs opacity-50">
                {{ t('quotes.catchphrase.times', { count: phrase.count }) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 词云视图 -->
      <div v-else class="grid grid-cols-2 gap-6">
        <div v-for="member in memberWordclouds" :key="member.name">
          <div class="mb-3 text-center">
            <span class="text-base font-semibold text-gray-900 dark:text-white">{{ member.name }}</span>
          </div>
          <div class="relative w-full" style="aspect-ratio: 4 / 3">
            <EmptyState
              v-if="member.data.words.length === 0"
              :text="t('quotes.catchphrase.empty.title')"
              class="h-full"
            />
            <EChartWordcloud
              v-else
              :data="member.data"
              height="100%"
              :max-words="topN"
              color-scheme="default"
              :size-scale="1"
              :loading="isLoading"
              @word-click="handleWordClick"
            />
          </div>
        </div>
      </div>

      <p class="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
        {{ t('quotes.catchphrase.stats.clickHint') }}
      </p>
    </template>
  </div>
</template>
