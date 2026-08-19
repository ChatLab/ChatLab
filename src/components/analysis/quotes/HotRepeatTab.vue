<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HotRepeatContent, RepeatAnalysis } from '@openchatlab/core'
import LazyAvatar from '@/components/common/avatar/LazyAvatar.vue'
import { useDataService } from '@/services/data/service'
import { ListPro } from '@/components/charts'
import { LoadingState, EmptyState, SectionCard } from '@/components/UI'
import { formatDate, formatRankNumber, getRankNumberClass } from '@/utils'
import { getRankAvatarText, resolveRankAvatar, useRankAvatarIndex } from '@/utils/rankAvatars'
import { useLayoutStore } from '@/stores/layout'
import type { TimeFilter } from '@openchatlab/shared-types'

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const layoutStore = useLayoutStore()
const avatarIndex = useRankAvatarIndex()

function originatorAvatar(item: HotRepeatContent): string | null {
  return resolveRankAvatar(item.originatorId, undefined, avatarIndex.value.byId, {
    name: item.originatorName,
    byName: avatarIndex.value.byName,
  })
}

// ==================== 最火复读内容 ====================
const repeatAnalysis = ref<RepeatAnalysis | null>(null)
const isLoading = ref(false)

async function loadRepeatAnalysis() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    repeatAnalysis.value = await useDataService().getRepeatAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('Failed to load repeat analysis:', error)
  } finally {
    isLoading.value = false
  }
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
      :top-n="10"
      :count-label="t('quotes.hotRepeat.countTemplate', { count: repeatAnalysis.hotContents.length })"
    >
      <template #item="{ item, index }">
        <button
          type="button"
          class="group/item grid w-full grid-cols-[2rem_2rem_minmax(0,1fr)_auto] items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
          :aria-label="`${t('quotes.hotRepeat.viewChat')}: ${item.content}`"
          @click="viewRepeatContext(item)"
        >
          <span
            class="w-8 shrink-0 pt-0.5 text-center font-mono text-sm font-black tabular-nums"
            :class="getRankNumberClass(index)"
          >
            {{ formatRankNumber(index) }}
          </span>
          <LazyAvatar
            :src="originatorAvatar(item)"
            :alt="item.originatorName"
            :text="getRankAvatarText(item.originatorName)"
            root-class="h-8 w-8 shrink-0"
            image-class="h-8 w-8 rounded-full object-cover"
            fallback-class="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-br from-pink-100 to-rose-100 text-[10px] font-medium text-pink-600 dark:from-pink-900/30 dark:to-rose-900/30 dark:text-pink-400"
          />
          <div class="min-w-0">
            <p class="line-clamp-2 text-sm font-medium leading-5 text-gray-900 dark:text-white" :title="item.content">
              {{ item.content }}
            </p>
            <div class="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
              <span class="truncate">{{ item.originatorName }}</span>
              <span aria-hidden="true">·</span>
              <span class="shrink-0">{{ formatDate(item.lastTs) }}</span>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-3 pl-2">
            <div class="text-right">
              <p class="font-mono text-sm font-black tabular-nums text-primary-600 dark:text-primary-400">
                {{ t('quotes.hotRepeat.people', { count: item.maxChainLength }) }}
              </p>
              <p class="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
                {{ t('quotes.hotRepeat.times', { count: item.count }) }}
              </p>
            </div>
            <UIcon
              name="i-heroicons-chevron-right"
              class="h-4 w-4 text-gray-300 transition-colors group-hover/item:text-gray-500 dark:text-gray-600 dark:group-hover/item:text-gray-400"
            />
          </div>
        </button>
      </template>
    </ListPro>

    <!-- 空状态 -->
    <SectionCard v-else :title="t('quotes.hotRepeat.title')">
      <EmptyState :text="t('quotes.hotRepeat.empty')" />
    </SectionCard>
  </div>
</template>
