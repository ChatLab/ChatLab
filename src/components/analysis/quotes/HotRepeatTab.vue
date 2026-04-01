<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RepeatAnalysis } from '@openchatlab/chart-ranking/types'
import { queryRepeatAnalysis } from '@openchatlab/chart-ranking/queries'
import { ListPro } from '@/components/charts'
import { LoadingState, EmptyState, SectionCard } from '@/components/UI'
import { formatDate, getRankBadgeClass } from '@/utils'
import { useLayoutStore } from '@/stores/layout'

const { t } = useI18n()

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const layoutStore = useLayoutStore()

// ==================== 最火复读内容 ====================
const repeatAnalysis = ref<RepeatAnalysis | null>(null)
const isLoading = ref(false)

async function loadRepeatAnalysis() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    repeatAnalysis.value = await queryRepeatAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('Failed to load repeat analysis:', error)
  } finally {
    isLoading.value = false
  }
}

function truncateContent(content: string, maxLength = 30): string {
  if (content.length <= maxLength) return content
  return content.slice(0, maxLength) + '...'
}

/**
 * 查看复读内容的聊天记录上下文
 */
function viewRepeatContext(item: { content: string; firstMessageId: number }) {
  layoutStore.openChatRecordDrawer({
    scrollToMessageId: item.firstMessageId,
    highlightKeywords: [item.content],
  })
}

// 监听 sessionId 和 timeFilter 变化
watch(
  () => [props.sessionId, props.timeFilter],
  () => {
    loadRepeatAnalysis()
  },
  { immediate: true, deep: true }
)
</script>

<template>
  <div class="main-content mx-auto max-w-3xl p-6">
    <!-- 加载中 -->
    <LoadingState v-if="isLoading" :text="t('quotes.hotRepeat.loading')" />

    <!-- 最火复读内容列表 -->
    <ListPro
      v-else-if="repeatAnalysis && repeatAnalysis.hotContents.length > 0"
      :items="repeatAnalysis.hotContents"
      :title="t('quotes.hotRepeat.title')"
      :description="t('quotes.hotRepeat.description')"
      :top-n="50"
      :count-template="t('quotes.hotRepeat.countTemplate')"
    >
      <template #item="{ item, index }">
        <div class="flex items-center gap-3">
          <span
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
            :class="getRankBadgeClass(index)"
          >
            {{ index + 1 }}
          </span>
          <span class="shrink-0 text-lg font-bold text-pink-600">
            {{ t('quotes.hotRepeat.people', { count: item.maxChainLength }) }}
          </span>
          <div class="flex flex-1 items-center gap-1 overflow-hidden text-sm">
            <span class="shrink-0 font-medium text-gray-900 dark:text-white whitespace-nowrap">
              {{ item.originatorName }}{{ t('quotes.hotRepeat.colon') }}
            </span>
            <span class="truncate text-gray-600 dark:text-gray-400" :title="item.content">
              {{ truncateContent(item.content) }}
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-2 text-xs text-gray-500">
            <span>{{ t('quotes.hotRepeat.times', { count: item.count }) }}</span>
            <span class="text-gray-300 dark:text-gray-600">|</span>
            <span>{{ formatDate(item.lastTs) }}</span>
            <UButton
              icon="i-heroicons-chat-bubble-left-right"
              color="neutral"
              variant="ghost"
              size="xs"
              :title="t('quotes.hotRepeat.viewChat')"
              @click.stop="viewRepeatContext(item)"
            />
          </div>
        </div>
      </template>
    </ListPro>

    <!-- 空状态 -->
    <SectionCard v-else :title="t('quotes.hotRepeat.title')">
      <EmptyState :text="t('quotes.hotRepeat.empty')" />
    </SectionCard>
  </div>
</template>
