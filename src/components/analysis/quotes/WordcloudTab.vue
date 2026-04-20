<script setup lang="ts">
import { ref, watch, computed, onMounted, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
const EChartWordcloud = defineAsyncComponent(() => import('@/components/charts/EChartWordcloud.vue'))
import type { EChartWordcloudData } from '@/components/charts'
import { LoadingState, UITabs, SectionCard } from '@/components/UI'
import TopicProfileCard from './TopicProfileCard.vue'
import SharedTopicsCard from './SharedTopicsCard.vue'
import type { WordFrequencyItem, PosTagStat } from './topicProfileTypes'
import UserSelect from '@/components/common/UserSelect.vue'
import WordFilterModal from '@/components/common/WordFilterModal.vue'
import { useSettingsStore } from '@/stores/settings'
import { useLayoutStore } from '@/stores/layout'
import { useWordFilterStore } from '@/stores/wordFilter'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const layoutStore = useLayoutStore()
const wordFilterStore = useWordFilterStore()
const toast = useToast()

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
type DictType = 'default' | 'zh-CN' | 'zh-TW'

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
  memberId?: number | null
  showSharedTopics?: boolean
}>()

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

// 话题迷你词云专用数据（独立调用，仅含话题相关词性）
const TOPIC_POS_TAGS = ['n', 'nr', 'ns', 'nt', 'nz', 'nw', 'vn', 'a', 'an']
const topicMiniWords = ref<WordFrequencyItem[]>([])

// 传给 TopicProfileCard 的主数据
const topWords = computed<WordFrequencyItem[]>(() =>
  wordcloudData.value.words.map((w) => ({
    word: w.word,
    count: w.count,
    percentage: w.percentage ?? 0,
  }))
)

const posTagStatsArray = computed<PosTagStat[]>(() =>
  [...posTagStats.value.entries()].map(([tag, count]) => ({ tag, count }))
)

// 用户筛选（本地状态，覆盖 props.memberId）
const selectedMemberId = ref<number | null>(null)

// 过滤方案
const activeFilterSchemeId = computed({
  get: () => wordFilterStore.getActiveSchemeId(props.sessionId),
  set: (v) => wordFilterStore.setSessionScheme(props.sessionId, v),
})

const filterSchemeOptions = computed(() => [
  { label: t('wordFilter.noFilter'), value: '__none__' },
  ...wordFilterStore.schemeOptions.map((s) => ({
    label: s.isDefault ? `${s.label} ★` : s.label,
    value: s.value,
  })),
])

const filterSchemeSelectValue = computed({
  get: () => activeFilterSchemeId.value ?? '__none__',
  set: (v) => {
    activeFilterSchemeId.value = v === '__none__' ? null : v
  },
})

const currentExcludeWords = computed(() => wordFilterStore.getExcludeWords(props.sessionId))

// ==================== 词库切换 ====================
const selectedDictType = ref<DictType>('default')
const dictList = ref<Array<{ id: string; label: string; locale: string; downloaded: boolean; fileSize?: number }>>([])
const isDictDownloading = ref(false)
const downloadingDictId = ref<string | null>(null)
const showDictPromptModal = ref(false)
const DICT_PROMPT_DISMISSED_KEY = 'chatlab_zhTW_dict_prompt_dismissed'

const locale = computed(() => settingsStore.locale as 'zh-CN' | 'en-US' | 'zh-TW' | 'ja-JP')
const isTraditionalChinese = computed(() => settingsStore.locale === 'zh-TW')
const requiresChineseDict = computed(() => locale.value.startsWith('zh'))

const dictOptions = computed(() => {
  return dictList.value
    .filter((d) => d.downloaded)
    .map((d) => ({
      label: t(`quotes.wordcloud.dict.${d.id === 'zh-CN' ? 'zhCN' : d.id === 'zh-TW' ? 'zhTW' : d.id}`),
      value: d.id as DictType,
    }))
})

const hasAnyDict = computed(() => {
  return dictList.value.some((d) => d.downloaded)
})
const canAnalyzeWithoutDictBlocking = computed(() => !requiresChineseDict.value || hasAnyDict.value)

const undownloadedDicts = computed(() => {
  return dictList.value.filter((d) => !d.downloaded)
})

async function refreshDictList() {
  try {
    dictList.value = await window.nlpApi.getDictList()
    // 繁体中文用户自动切换到 zh-TW（如已下载）
    if (isTraditionalChinese.value && selectedDictType.value === 'default') {
      const zhTW = dictList.value.find((d) => d.id === 'zh-TW')
      if (zhTW?.downloaded) {
        selectedDictType.value = 'zh-TW'
      }
    }
    // 如果 zh-CN 已下载，default 应该用 zh-CN
    const zhCN = dictList.value.find((d) => d.id === 'zh-CN')
    if (zhCN?.downloaded && selectedDictType.value === 'default') {
      selectedDictType.value = 'zh-CN'
    }
  } catch (error) {
    console.error('Failed to get dict list:', error)
  }
}

async function handleDownloadDict(dictId: string) {
  isDictDownloading.value = true
  downloadingDictId.value = dictId
  try {
    const result = await window.nlpApi.downloadDict(dictId)
    if (result.success) {
      await refreshDictList()
      selectedDictType.value = dictId as DictType
      toast.success(t('quotes.wordcloud.dict.downloadSuccess'))
    } else {
      toast.fail(t('quotes.wordcloud.dict.downloadFailed'), { description: result.error })
    }
  } catch (error) {
    toast.fail(t('quotes.wordcloud.dict.downloadFailed'))
  } finally {
    isDictDownloading.value = false
    downloadingDictId.value = null
    showDictPromptModal.value = false
  }
}

function dismissDictPrompt() {
  showDictPromptModal.value = false
  localStorage.setItem(DICT_PROMPT_DISMISSED_KEY, 'true')
}

function maybeShowDictPrompt() {
  const zhTW = dictList.value.find((d) => d.id === 'zh-TW')
  if (isTraditionalChinese.value && zhTW && !zhTW.downloaded && !localStorage.getItem(DICT_PROMPT_DISMISSED_KEY)) {
    showDictPromptModal.value = true
  }
}

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

// 加载话题迷你词云数据（固定词性过滤）
async function loadTopicMiniWords() {
  if (!props.sessionId || !canAnalyzeWithoutDictBlocking.value) return
  try {
    const result = await window.nlpApi.getWordFrequency({
      sessionId: props.sessionId,
      locale: locale.value,
      timeFilter: props.timeFilter ? { startTs: props.timeFilter.startTs, endTs: props.timeFilter.endTs } : undefined,
      memberId: selectedMemberId.value ?? undefined,
      topN: 50,
      minCount: 2,
      posFilterMode: 'custom',
      customPosTags: [...TOPIC_POS_TAGS],
      enableStopwords: true,
      dictType: selectedDictType.value,
      excludeWords: currentExcludeWords.value.length > 0 ? [...currentExcludeWords.value] : undefined,
    })
    topicMiniWords.value = result.words.map((w) => ({
      word: w.word,
      count: w.count,
      percentage: w.percentage,
    }))
  } catch (error) {
    console.error('加载话题迷你词云数据失败:', error)
    topicMiniWords.value = []
  }
}

// 加载词频数据
async function loadWordFrequency() {
  if (!props.sessionId || !canAnalyzeWithoutDictBlocking.value) return

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
      dictType: selectedDictType.value,
      excludeWords: currentExcludeWords.value.length > 0 ? [...currentExcludeWords.value] : undefined,
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

// 切换会话时重置用户筛选
watch(
  () => props.sessionId,
  () => {
    selectedMemberId.value = null
  }
)

// 监听参数变化（词云主图）
watch(
  () => [
    props.sessionId,
    props.timeFilter,
    selectedMemberId.value,
    maxWords.value,
    posFilterMode.value,
    enableStopwords.value,
    selectedDictType.value,
    currentExcludeWords.value,
  ],
  () => {
    loadWordFrequency()
  },
  { immediate: true, deep: true }
)

// 监听参数变化（话题迷你词云：不受词性过滤/最大词数影响）
watch(
  () => [props.sessionId, props.timeFilter, selectedMemberId.value, selectedDictType.value, currentExcludeWords.value],
  () => {
    loadTopicMiniWords()
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

onMounted(async () => {
  loadPosTagDefinitions()
  await refreshDictList()
  maybeShowDictPrompt()
})
</script>

<template>
  <div class="main-content mx-auto max-w-[920px] space-y-6 p-6">
    <!-- 需要下载词库（全屏提示） -->
    <div
      v-if="requiresChineseDict && !hasAnyDict"
      class="flex h-64 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-gray-300 dark:border-gray-600"
    >
      <UIcon name="i-heroicons-arrow-down-tray" class="text-4xl text-gray-400" />
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{ t('quotes.wordcloud.dict.needDownload') }}
      </p>
      <div class="flex gap-2">
        <UButton
          v-for="dict in dictList"
          :key="dict.id"
          size="sm"
          color="primary"
          :loading="isDictDownloading && downloadingDictId === dict.id"
          :disabled="isDictDownloading && downloadingDictId !== dict.id"
          icon="i-heroicons-arrow-down-tray"
          @click="handleDownloadDict(dict.id)"
        >
          {{ t(`quotes.wordcloud.dict.download_${dict.id}`, dict.label) }}
        </UButton>
      </div>
    </div>

    <template v-else>
      <div class="space-y-6">
        <LoadingState v-if="isLoading && topWords.length === 0" :text="t('quotes.wordcloud.loading')" class="py-8" />

        <!-- 1. 话题画像卡（主角） -->
        <TopicProfileCard
          :total-messages="stats.totalMessages"
          :total-words="stats.totalWords"
          :unique-words="stats.uniqueWords"
          :top-words="topWords"
          :topic-words="topicMiniWords"
          :pos-tag-stats="posTagStatsArray"
          :time-filter="props.timeFilter"
          @word-click="handleWordClick"
        />

        <!-- 2. 共同话题（仅私聊） -->
        <SharedTopicsCard
          v-if="props.showSharedTopics"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
          :dict-type="selectedDictType"
          :exclude-words="currentExcludeWords"
          @word-click="handleWordClick"
        />

        <!-- 3. 热门词汇分布（词云 + 配置面板） -->
        <SectionCard :title="t('quotes.wordcloud.stats.wordsLabel')" :show-divider="false">
          <div class="flex gap-6 p-4 sm:p-6">
            <!-- 左侧：词云图 -->
            <div class="flex min-w-0 flex-1 flex-col">
              <div class="relative w-full" style="aspect-ratio: 16 / 9">
                <LoadingState
                  v-if="isLoading"
                  :text="t('quotes.wordcloud.loading')"
                  class="absolute inset-0 z-10 rounded-lg bg-white/80 dark:bg-gray-900/80"
                />
                <div
                  v-else-if="topWords.length === 0"
                  class="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50/40 text-gray-500 dark:border-gray-700 dark:bg-gray-800/30 dark:text-gray-400"
                >
                  <UIcon name="i-heroicons-chat-bubble-bottom-center-text" class="text-2xl" />
                  <p class="text-xs font-medium">{{ t('quotes.wordcloud.empty.title') }}</p>
                  <p class="px-4 text-center text-[11px]">{{ t('quotes.wordcloud.empty.description') }}</p>
                </div>
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
              <p class="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
                {{ t('quotes.wordcloud.stats.clickHint') }}
              </p>
            </div>

            <!-- 右侧：配置面板（平铺展示） -->
            <div class="w-[280px] shrink-0 space-y-4">
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

              <!-- 词库选择 -->
              <div>
                <h4 class="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">
                  {{ t('quotes.wordcloud.config.dict') }}
                </h4>
                <div class="space-y-2">
                  <UITabs v-if="dictOptions.length > 1" v-model="selectedDictType" size="xs" :items="dictOptions" />
                  <div v-for="dict in undownloadedDicts" :key="dict.id" class="flex items-center gap-2">
                    <UButton
                      size="xs"
                      variant="soft"
                      color="primary"
                      :loading="isDictDownloading && downloadingDictId === dict.id"
                      :disabled="isDictDownloading && downloadingDictId !== dict.id"
                      icon="i-heroicons-arrow-down-tray"
                      @click="handleDownloadDict(dict.id)"
                    >
                      {{ t(`quotes.wordcloud.dict.download_${dict.id}`, t('quotes.wordcloud.dict.download')) }}
                    </UButton>
                    <span class="text-xs text-gray-400 dark:text-gray-500">
                      {{ t('quotes.wordcloud.dict.downloadHint') }}
                    </span>
                  </div>
                </div>
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
                <div class="flex max-h-[360px] flex-wrap gap-1.5 overflow-y-auto">
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

              <!-- 关键词过滤 -->
              <div>
                <div class="mb-2 flex items-center justify-between">
                  <h4 class="text-xs font-medium text-gray-600 dark:text-gray-400">
                    {{ t('wordFilter.filterScheme') }}
                  </h4>
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    icon="i-heroicons-cog-6-tooth"
                    :aria-label="t('wordFilter.manage')"
                    @click="wordFilterStore.openModal()"
                  />
                </div>
                <UITabs v-model="filterSchemeSelectValue" size="xs" :items="filterSchemeOptions" />
                <p v-if="currentExcludeWords.length > 0" class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  {{ t('wordFilter.activeCount', { count: currentExcludeWords.length }) }}
                </p>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>
    </template>

    <!-- 繁体中文词库下载提示弹窗 -->
    <UModal v-model:open="showDictPromptModal" :title="t('quotes.wordcloud.dict.promptTitle')">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-gray-600 dark:text-gray-300">
            {{ t('quotes.wordcloud.dict.promptDescription') }}
          </p>
          <div class="flex justify-end gap-2">
            <UButton variant="ghost" color="neutral" @click="dismissDictPrompt">
              {{ t('quotes.wordcloud.dict.promptLater') }}
            </UButton>
            <UButton color="primary" :loading="isDictDownloading" @click="handleDownloadDict('zh-TW')">
              {{ t('quotes.wordcloud.dict.promptDownload') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 过滤方案管理弹窗 -->
    <WordFilterModal />
  </div>
</template>
