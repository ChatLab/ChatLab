<script setup lang="ts">
import { ref, watch, computed, onMounted, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
const EChartWordcloud = defineAsyncComponent(() => import('@/components/charts/EChartWordcloud.vue'))
import type { EChartWordcloudData } from '@/components/charts'
import { LoadingState, EmptyState, UITabs } from '@/components/UI'
import UserSelect from '@/components/common/UserSelect.vue'
import { useSettingsStore } from '@/stores/settings'
import { useLayoutStore } from '@/stores/layout'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const layoutStore = useLayoutStore()

interface TimeFilter {
  startTs?: number
  endTs?: number
}

interface PosTagInfo {
  tag: string
  name: string
  description: string
  meaningful: boolean
}

type PosFilterMode = 'all' | 'meaningful' | 'custom'

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
  memberId?: number | null
}>()

// 状态
const isLoading = ref(false)
const wordcloudData = ref<EChartWordcloudData>({ words: [] })
const stats = ref({
  totalMessages: 0,
  totalWords: 0,
  uniqueWords: 0,
})

// 颜色方案（固定为默认）
const colorScheme = 'default' as const

// 字体大小倍率（默认大）
const sizeScale = ref(1.25)

// 最大显示词数（默认 150）
const maxWords = ref(150)

// 词性过滤模式
const posFilterMode = ref<PosFilterMode>('meaningful')

// 停用词过滤开关
const enableStopwords = ref(true)

// 自定义词性标签（用于 custom 模式）
const customPosTags = ref<string[]>([])

// 所有词性标签定义
const posTagDefinitions = ref<PosTagInfo[]>([])

// 词性统计（每个词性有多少词）
const posTagStats = ref<Map<string, number>>(new Map())

// 用户筛选（本地状态，覆盖 props.memberId）
const selectedMemberId = ref<number | null>(null)

// 获取当前语言设置
const locale = computed(() => settingsStore.locale as 'zh-CN' | 'en-US')

// 词性过滤模式选项
const posFilterModeOptions = computed(() => [
  { label: t('quotes.wordcloud.posFilter.all'), value: 'all' },
  { label: t('quotes.wordcloud.posFilter.meaningful'), value: 'meaningful' },
  { label: t('quotes.wordcloud.posFilter.custom'), value: 'custom' },
])

// 词数选项
const maxWordsOptions = [
  { label: '80', value: 80 },
  { label: '100', value: 100 },
  { label: '150', value: 150 },
  { label: '200', value: 200 },
  { label: '300', value: 300 },
]

// 字体大小选项
const sizeScaleOptions = computed(() => [
  { label: t('quotes.wordcloud.size.small'), value: 0.75 },
  { label: t('quotes.wordcloud.size.medium'), value: 1 },
  { label: t('quotes.wordcloud.size.large'), value: 1.25 },
  { label: t('quotes.wordcloud.size.xlarge'), value: 1.5 },
])

// 词性标签选项（用于多选，带词数）
const posTagOptions = computed(() =>
  posTagDefinitions.value.map((p) => ({
    label: p.name,
    tag: p.tag,
    value: p.tag,
    count: posTagStats.value.get(p.tag) || 0,
    meaningful: p.meaningful,
  }))
)

// 加载词性标签定义
async function loadPosTagDefinitions() {
  try {
    const tags = await window.nlpApi.getPosTags()
    posTagDefinitions.value = tags
    // 初始化自定义词性为有意义的词性
    customPosTags.value = tags.filter((t) => t.meaningful).map((t) => t.tag)
  } catch (error) {
    console.error('加载词性标签失败:', error)
  }
}

// 加载词频数据
async function loadWordFrequency() {
  if (!props.sessionId) return

  isLoading.value = true
  try {
    const result = await window.nlpApi.getWordFrequency({
      sessionId: props.sessionId,
      locale: locale.value,
      timeFilter: props.timeFilter ? { startTs: props.timeFilter.startTs, endTs: props.timeFilter.endTs } : undefined,
      memberId: selectedMemberId.value ?? undefined,
      topN: maxWords.value,
      minCount: 2,
      posFilterMode: posFilterMode.value,
      customPosTags: posFilterMode.value === 'custom' ? [...customPosTags.value] : undefined,
      enableStopwords: enableStopwords.value,
    })

    wordcloudData.value = {
      words: result.words.map((w) => ({
        word: w.word,
        count: w.count,
        percentage: w.percentage,
      })),
    }

    stats.value = {
      totalMessages: result.totalMessages,
      totalWords: result.totalWords,
      uniqueWords: result.uniqueWords,
    }

    // 更新词性统计
    if (result.posTagStats) {
      const statsMap = new Map<string, number>()
      for (const stat of result.posTagStats) {
        statsMap.set(stat.tag, stat.count)
      }
      posTagStats.value = statsMap
    }
  } catch (error) {
    console.error('加载词频数据失败:', error)
    wordcloudData.value = { words: [] }
  } finally {
    isLoading.value = false
  }
}

// 监听参数变化
watch(
  () => [
    props.sessionId,
    props.timeFilter,
    selectedMemberId.value,
    maxWords.value,
    posFilterMode.value,
    enableStopwords.value,
  ],
  () => {
    loadWordFrequency()
  },
  { immediate: true, deep: true }
)

// 监听自定义词性变化（仅在 custom 模式下）
watch(
  customPosTags,
  () => {
    if (posFilterMode.value === 'custom') {
      loadWordFrequency()
    }
  },
  { deep: true }
)

// 监听语言变化（需要重新分词）
watch(locale, () => {
  loadWordFrequency()
})

// 点击词语，打开聊天记录查看器
function handleWordClick(word: string) {
  layoutStore.openChatRecordDrawer({
    keywords: [word],
  })
}

// 初始化
onMounted(() => {
  loadPosTagDefinitions()
})
</script>

<template>
  <div class="main-content mx-auto max-w-6xl py-6">
    <div class="flex gap-6">
      <!-- 左侧：词云主展示区 + 统计信息 -->
      <div class="flex-1 min-w-0 space-y-4">
        <!-- 词云区域（固定 16:9 长宽比） -->
        <div class="relative w-full" style="aspect-ratio: 16 / 9">
          <!-- 加载状态 -->
          <LoadingState
            v-if="isLoading"
            :text="t('quotes.wordcloud.loading')"
            class="absolute inset-0 z-10 rounded-lg bg-white/80 dark:bg-gray-900/80"
          />

          <!-- 空状态 -->
          <EmptyState
            v-else-if="wordcloudData.words.length === 0"
            icon="i-heroicons-cloud"
            :title="t('quotes.wordcloud.empty.title')"
            :description="t('quotes.wordcloud.empty.description')"
            class="h-full"
          />

          <!-- 词云图表 -->
          <EChartWordcloud
            v-else
            :data="wordcloudData"
            height="100%"
            :max-words="maxWords"
            :color-scheme="colorScheme"
            :size-scale="sizeScale"
            :loading="isLoading"
            @word-click="handleWordClick"
          />
        </div>

        <!-- 统计信息（横向排列，美观展示） -->
        <div class="flex items-center justify-center gap-8 py-3">
          <div class="flex items-center gap-2">
            <UIcon name="i-heroicons-chat-bubble-left-right" class="text-lg text-primary-500" />
            <div class="text-center">
              <div class="text-2xl font-bold text-gray-900 dark:text-white">
                {{ stats.totalMessages.toLocaleString() }}
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('quotes.wordcloud.stats.messagesLabel') }}
              </div>
            </div>
          </div>
          <div class="h-8 w-px bg-gray-200 dark:bg-gray-700" />
          <div class="flex items-center gap-2">
            <UIcon name="i-heroicons-document-text" class="text-lg text-emerald-500" />
            <div class="text-center">
              <div class="text-2xl font-bold text-gray-900 dark:text-white">
                {{ stats.totalWords.toLocaleString() }}
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('quotes.wordcloud.stats.wordsLabel') }}</div>
            </div>
          </div>
          <div class="h-8 w-px bg-gray-200 dark:bg-gray-700" />
          <div class="flex items-center gap-2">
            <UIcon name="i-heroicons-sparkles" class="text-lg text-amber-500" />
            <div class="text-center">
              <div class="text-2xl font-bold text-gray-900 dark:text-white">
                {{ stats.uniqueWords.toLocaleString() }}
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('quotes.wordcloud.stats.uniqueLabel') }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：筛选与配置面板 -->
      <div class="w-[300px] shrink-0 space-y-4">
        <!-- 显示词数 -->
        <div>
          <h4 class="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">
            {{ t('quotes.wordcloud.config.maxWords') }}
          </h4>
          <UITabs v-model="maxWords" size="xs" :items="maxWordsOptions" />
        </div>

        <!-- 字体大小 -->
        <div>
          <h4 class="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">
            {{ t('quotes.wordcloud.config.sizeScale') }}
          </h4>
          <UITabs v-model="sizeScale" size="xs" :items="sizeScaleOptions" />
        </div>

        <!-- 用户筛选 -->
        <div>
          <h4 class="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">
            {{ t('quotes.wordcloud.config.userFilter') }}
          </h4>
          <UserSelect v-model="selectedMemberId" :session-id="props.sessionId" class="w-full" />
        </div>

        <!-- 词性过滤 -->
        <div>
          <h4 class="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">
            {{ t('quotes.wordcloud.config.posFilter') }}
          </h4>
          <UITabs v-model="posFilterMode" size="xs" :items="posFilterModeOptions" />
        </div>

        <!-- 停用词过滤 -->
        <div class="flex items-center">
          <UCheckbox v-model="enableStopwords" :label="t('quotes.wordcloud.config.enableStopwords')" />
        </div>

        <!-- 自定义词性选择（仅在 custom 模式下显示） -->
        <div v-if="posFilterMode === 'custom'" class="space-y-2">
          <div class="flex items-center justify-between">
            <h4 class="text-xs font-medium text-gray-600 dark:text-gray-400">
              {{ t('quotes.wordcloud.posFilter.customHint') }}
            </h4>
            <!-- 快捷操作 -->
            <div class="flex gap-1">
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                @click="customPosTags = posTagDefinitions.filter((t) => t.meaningful).map((t) => t.tag)"
              >
                {{ t('quotes.wordcloud.posFilter.selectMeaningful') }}
              </UButton>
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                @click="customPosTags = posTagDefinitions.map((t) => t.tag)"
              >
                {{ t('quotes.wordcloud.posFilter.selectAll') }}
              </UButton>
              <UButton size="xs" variant="ghost" color="neutral" @click="customPosTags = []">
                {{ t('quotes.wordcloud.posFilter.clearAll') }}
              </UButton>
            </div>
          </div>
          <!-- 词性标签（带滚动） -->
          <div class="flex flex-wrap gap-1.5 max-h-[360px] overflow-y-auto">
            <UBadge
              v-for="tag in posTagOptions"
              :key="tag.value"
              :color="customPosTags.includes(tag.value) ? 'primary' : 'neutral'"
              :variant="customPosTags.includes(tag.value) ? 'solid' : 'outline'"
              class="cursor-pointer select-none transition-colors"
              @click="
                () => {
                  if (customPosTags.includes(tag.value)) {
                    customPosTags = customPosTags.filter((t) => t !== tag.value)
                  } else {
                    customPosTags = [...customPosTags, tag.value]
                  }
                }
              "
            >
              {{ tag.label }}
              <span v-if="tag.count > 0" class="ml-1 opacity-60">({{ tag.count }})</span>
            </UBadge>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
