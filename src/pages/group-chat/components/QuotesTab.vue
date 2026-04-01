<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SubTabs } from '@/components/UI'
import { CatchphraseTab, HotRepeatTab, KeywordAnalysis, WordcloudTab } from '@/components/analysis/quotes'

const { t } = useI18n()

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

// 子 Tab 配置
const subTabs = computed(() => [
  { id: 'wordcloud', label: t('analysis.subTabs.quotes.wordcloud'), icon: 'i-heroicons-cloud' },
  { id: 'hot-repeat', label: t('analysis.subTabs.quotes.hotRepeat'), icon: 'i-heroicons-fire' },
  {
    id: 'catchphrase',
    label: t('analysis.subTabs.quotes.catchphrase'),
    icon: 'i-heroicons-chat-bubble-bottom-center-text',
  },
  { id: 'keyword', label: t('analysis.subTabs.quotes.keywordAnalysis'), icon: 'i-heroicons-magnifying-glass' },
])

const activeSubTab = ref('wordcloud')
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 子 Tab 导航 -->
    <SubTabs v-model="activeSubTab" :items="subTabs" persist-key="quotesTab" />

    <!-- 子 Tab 内容 -->
    <div class="flex-1 min-h-0 overflow-auto">
      <Transition name="fade" mode="out-in">
        <!-- 口头禅分析 -->
        <CatchphraseTab
          v-if="activeSubTab === 'catchphrase'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
        />

        <!-- 最火复读内容 -->
        <HotRepeatTab
          v-else-if="activeSubTab === 'hot-repeat'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
        />

        <!-- 词云分析 -->
        <WordcloudTab
          v-else-if="activeSubTab === 'wordcloud'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
        />

        <!-- 关键词分析 -->
        <div v-else-if="activeSubTab === 'keyword'" class="main-content mx-auto max-w-3xl p-6">
          <KeywordAnalysis :session-id="props.sessionId" :time-filter="props.timeFilter" />
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
