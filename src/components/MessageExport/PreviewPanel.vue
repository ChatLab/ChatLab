<script setup lang="ts">
/**
 * 预览面板
 * 左右结构：左侧对话块列表（虚拟滚动），右侧消息内容（复用 MessageList）
 * 支持连续滚动：滚动到底部时自动加载下一个对话块
 * 支持分页加载：滚动到左侧列表底部时触发加载更多
 */

import { computed, ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import MessageList from '@/components/common/ChatRecord/MessageList.vue'
import LoadingState from '@/components/UI/LoadingState.vue'
import type { ChatRecordMessage } from '@/types/format'

const { t } = useI18n()

// 分页信息类型
interface PaginationInfo {
  page: number
  pageSize: number
  totalBlocks: number
  totalHits: number
  hasMore: boolean
}

// Props
const props = defineProps<{
  result: {
    blocks: Array<{
      startTs: number
      endTs: number
      messages: Array<{
        id: number
        senderName: string
        senderPlatformId: string
        senderAliases: string[]
        senderAvatar: string | null
        content: string
        timestamp: number
        type: number
        replyToMessageId: string | null
        replyToContent: string | null
        replyToSenderName: string | null
        isHit: boolean
      }>
      hitCount: number
    }>
    stats: {
      totalMessages: number
      hitMessages: number
      totalChars: number
    }
    pagination?: PaginationInfo
  } | null
  isLoading: boolean
  isLoadingMore?: boolean
}>()

// Emits
const emit = defineEmits<{
  (e: 'load-more'): void
}>()

// 当前选中的对话块索引（用于左侧高亮和右侧显示）
const selectedBlockIndex = ref(0)

// 防止块切换时的循环触发
let isBlockSwitching = false

// 需要滚动到的消息 ID（选择块后滚动到第一条命中消息）
const pendingScrollToMessageId = ref<number | null>(null)

// MessageList 组件引用
const messageListRef = ref<InstanceType<typeof MessageList> | null>(null)

// 左侧列表滚动容器
const blockListRef = ref<HTMLElement | null>(null)

// 获取反转索引对应的原始块（避免复制整个数组）
function getBlockAtReversedIndex(index: number) {
  if (!props.result) return null
  const originalIndex = props.result.blocks.length - 1 - index
  return props.result.blocks[originalIndex]
}

// 块数量
const blockCount = computed(() => props.result?.blocks.length ?? 0)

// 虚拟滚动配置（对话块列表）
const blockVirtualizer = useVirtualizer(
  computed(() => ({
    count: blockCount.value,
    getScrollElement: () => blockListRef.value,
    estimateSize: () => 72, // 估算每个块项高度
    overscan: 5,
  }))
)

const virtualBlocks = computed(() => blockVirtualizer.value.getVirtualItems())

// 当前块的消息列表（使用反转后的索引）
const currentBlockMessages = computed<ChatRecordMessage[]>(() => {
  if (blockCount.value === 0) return []
  const block = getBlockAtReversedIndex(selectedBlockIndex.value)
  if (!block) return []

  return block.messages.map((msg) => ({
    id: msg.id,
    senderName: msg.senderName,
    senderPlatformId: msg.senderPlatformId,
    senderAliases: msg.senderAliases,
    senderAvatar: msg.senderAvatar,
    content: msg.content,
    timestamp: msg.timestamp,
    type: msg.type,
    replyToMessageId: msg.replyToMessageId,
    replyToContent: msg.replyToContent,
    replyToSenderName: msg.replyToSenderName,
  }))
})

// 当前块的命中消息 ID 列表（使用反转后的索引）
const hitMessageIds = computed<number[]>(() => {
  if (blockCount.value === 0) return []
  const block = getBlockAtReversedIndex(selectedBlockIndex.value)
  if (!block) return []

  return block.messages.filter((msg) => msg.isHit).map((msg) => msg.id)
})

// 空查询对象（MessageList 外部模式需要）
const emptyQuery = { startTs: 0, endTs: 0 }

// 判断是否需要显示年份（如果对话块跨越多个年份则显示）
// 优化：只检查第一个和最后一个块
const shouldShowYear = computed(() => {
  if (!props.result || props.result.blocks.length === 0) return false

  const blocks = props.result.blocks
  const firstYear = new Date(blocks[0].startTs * 1000).getFullYear()
  const lastYear = new Date(blocks[blocks.length - 1].endTs * 1000).getFullYear()

  return firstYear !== lastYear
})

// 格式化时间
function formatDateTime(ts: number): string {
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }

  if (shouldShowYear.value) {
    options.year = 'numeric'
  }

  return new Date(ts * 1000).toLocaleString('zh-CN', options)
}

function formatDuration(startTs: number, endTs: number): string {
  const diff = endTs - startTs
  if (diff < 60) return `${diff}秒`
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟`
  return `${Math.floor(diff / 3600)}h${Math.floor((diff % 3600) / 60)}m`
}

// 选择对话块（点击左侧列表项）
function selectBlock(index: number) {
  selectedBlockIndex.value = index

  // 找到该块中第一条命中的消息
  const block = getBlockAtReversedIndex(index)
  if (block) {
    const firstHitMessage = block.messages.find((msg) => msg.isHit)
    if (firstHitMessage) {
      pendingScrollToMessageId.value = firstHitMessage.id
    }
  }
}

// 切换到下一个对话块（滚动到底部时触发）
function goToNextBlock() {
  if (isBlockSwitching) return // 防止循环触发
  if (blockCount.value === 0) return
  if (selectedBlockIndex.value < blockCount.value - 1) {
    isBlockSwitching = true
    selectedBlockIndex.value++
    scrollToBlockInList(selectedBlockIndex.value)
    // 延迟解除锁定，等待 MessageList 完成加载
    setTimeout(() => {
      isBlockSwitching = false
    }, 300)
  }
}

// 原本是跳转到上一个块，但体验不好，暂时禁用

function goToPrevBlock() {
  // 禁用向上跳转，用户可以通过点击左侧列表手动切换
}

// 滚动左侧列表以显示指定块
function scrollToBlockInList(index: number) {
  blockVirtualizer.value.scrollToIndex(index, { align: 'center' })
}

// 监听 result 变化，重置选中索引
watch(
  () => props.result,
  () => {
    selectedBlockIndex.value = 0
    pendingScrollToMessageId.value = null
  }
)

// 监听待滚动的消息 ID，在消息列表加载后执行滚动
watch(pendingScrollToMessageId, async (messageId) => {
  if (messageId !== null) {
    await nextTick()
    // 等待 MessageList 加载完成
    setTimeout(() => {
      messageListRef.value?.scrollToMessage(messageId)
      pendingScrollToMessageId.value = null
    }, 100)
  }
})

// 处理左侧块列表滚动，接近底部时自动加载更多
function handleBlockListScroll(event: Event) {
  const target = event.target as HTMLElement
  if (!target || !props.result?.pagination?.hasMore || props.isLoadingMore) return

  // 距离底部 100px 时触发加载
  const threshold = 100
  const { scrollTop, scrollHeight, clientHeight } = target
  if (scrollHeight - scrollTop - clientHeight < threshold) {
    emit('load-more')
  }
}
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
    <!-- 统计信息栏 -->
    <div
      v-if="result && result.blocks.length > 0"
      class="flex-none px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
    >
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-6 text-sm">
          <span class="text-gray-600 dark:text-gray-400">
            {{ t('analysis.filter.stats.blocks') }}:
            <span class="font-medium text-gray-900 dark:text-white">
              {{ result.blocks.length }}
              <template v-if="result.pagination && result.pagination.totalBlocks > result.blocks.length">
                / {{ result.pagination.totalBlocks }}
              </template>
            </span>
          </span>
          <span class="text-gray-600 dark:text-gray-400">
            {{ t('analysis.filter.stats.messages') }}:
            <span class="font-medium text-gray-900 dark:text-white">{{ result.stats.totalMessages }}</span>
          </span>
          <span class="text-gray-600 dark:text-gray-400">
            {{ t('analysis.filter.stats.hits') }}:
            <span class="font-medium text-primary-500">
              {{ result.pagination?.totalHits ?? result.stats.hitMessages }}
            </span>
          </span>
          <span class="text-gray-600 dark:text-gray-400">
            {{ t('analysis.filter.stats.chars') }}:
            <span class="font-medium text-gray-900 dark:text-white">
              {{ result.stats.totalChars.toLocaleString() }}
            </span>
          </span>
        </div>
      </div>
    </div>

    <!-- 主内容区：左右结构 -->
    <div class="flex-1 min-h-0 flex overflow-hidden">
      <!-- 加载状态 -->
      <LoadingState v-if="isLoading" variant="page" :text="t('analysis.filter.filtering')" />

      <!-- 空状态 -->
      <div v-else-if="!result" class="w-full h-full flex items-center justify-center">
        <div class="text-center text-gray-400">
          <UIcon name="i-heroicons-funnel" class="w-12 h-12 mb-3 mx-auto" />
          <p>{{ t('analysis.filter.emptyHint') }}</p>
        </div>
      </div>

      <!-- 无结果 -->
      <div v-else-if="result.blocks.length === 0" class="flex-1 flex items-center justify-center">
        <div class="text-center text-gray-400">
          <UIcon name="i-heroicons-magnifying-glass" class="w-12 h-12 mb-3 mx-auto" />
          <p>{{ t('analysis.filter.noResults') }}</p>
        </div>
      </div>

      <!-- 有结果：左右结构 -->
      <template v-else>
        <!-- 左侧：对话块列表（虚拟滚动） -->
        <div
          class="w-64 flex-none border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col"
        >
          <div class="flex-none px-3 py-2 border-b border-gray-200 dark:border-gray-700">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('analysis.filter.stats.blocks') }}
              ({{ result.blocks.length }}
              <template v-if="result.pagination && result.pagination.totalBlocks > result.blocks.length">
                /{{ result.pagination.totalBlocks }}
              </template>
              )
            </span>
          </div>

          <div ref="blockListRef" class="flex-1 overflow-y-auto" @scroll="handleBlockListScroll">
            <div :style="{ height: `${blockVirtualizer.getTotalSize()}px`, position: 'relative' }">
              <div
                v-for="virtualItem in virtualBlocks"
                :key="String(virtualItem.key)"
                :style="{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }"
              >
                <div
                  class="px-3 py-2 cursor-pointer border-b border-gray-100 dark:border-gray-700 transition-colors"
                  :class="
                    selectedBlockIndex === virtualItem.index
                      ? 'bg-primary-50 dark:bg-primary-900/30 border-l-2 border-l-primary-500'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  "
                  @click="selectBlock(virtualItem.index)"
                >
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                      #{{ virtualItem.index + 1 }}
                    </span>
                    <span
                      v-if="(getBlockAtReversedIndex(virtualItem.index)?.hitCount ?? 0) > 0"
                      class="text-xs text-primary-500"
                    >
                      含 {{ getBlockAtReversedIndex(virtualItem.index)?.hitCount }} 个结果
                    </span>
                  </div>
                  <div class="text-xs text-gray-500">
                    {{ formatDateTime(getBlockAtReversedIndex(virtualItem.index)?.startTs ?? 0) }}
                  </div>
                  <div class="flex items-center gap-2 text-xs text-gray-400 mt-1">
                    <span>{{ getBlockAtReversedIndex(virtualItem.index)?.messages.length ?? 0 }} 条</span>
                    <span>·</span>
                    <span>
                      {{
                        formatDuration(
                          getBlockAtReversedIndex(virtualItem.index)?.startTs ?? 0,
                          getBlockAtReversedIndex(virtualItem.index)?.endTs ?? 0
                        )
                      }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 加载更多提示 -->
            <div
              v-if="result.pagination?.hasMore"
              class="py-3 text-center text-sm text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700"
            >
              <template v-if="isLoadingMore">
                <UIcon name="i-heroicons-arrow-path" class="w-4 h-4 animate-spin inline mr-1" />
                {{ t('common.loading') }}
              </template>
              <template v-else>
                <button class="text-primary-500 hover:text-primary-600" @click="emit('load-more')">
                  {{ t('analysis.filter.loadMore') }}
                </button>
              </template>
            </div>
            <div
              v-else-if="result.pagination && result.blocks.length >= result.pagination.totalBlocks"
              class="py-3 text-center text-xs text-gray-400 dark:text-gray-500"
            >
              {{ t('analysis.filter.allLoaded') }}
            </div>
          </div>
        </div>

        <!-- 右侧：消息内容（复用 MessageList） -->
        <div class="flex-1 overflow-hidden">
          <MessageList
            v-if="currentBlockMessages.length > 0"
            ref="messageListRef"
            :query="emptyQuery"
            :external-messages="currentBlockMessages"
            :hit-message-ids="hitMessageIds"
            class="h-full"
            @reach-bottom="goToNextBlock"
            @reach-top="goToPrevBlock"
          />
          <div v-else class="flex items-center justify-center h-full text-gray-400">
            {{ t('analysis.filter.noResults') }}
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
