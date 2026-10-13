<script setup lang="ts">
/**
 * 单条消息展示组件 - 气泡样式
 * 支持 Owner 消息显示在右侧（类似聊天界面）
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useClipboard, useResizeObserver } from '@vueuse/core'

import { analyzeMessyContent } from './messy-content'
import type { ChatRecordMessage } from './types'
import MemberAliasInput from '@/components/common/member/MemberAliasInput.vue'
import TagInput from '@/components/common/TagInput.vue'
import { chatTopicColorStyle } from './topic-highlight'
import { useSessionStore } from '@/stores/session'
import { useDataService } from '@/services'
import type { MessageMark } from '@/services/data/types'
import { IS_WEB_WASM } from '@/utils/platform'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()

const props = defineProps<{
  /** 消息数据 */
  message: ChatRecordMessage
  sessionId?: string
  /** 是否为目标消息（需要高亮） */
  isTarget?: boolean
  /** 话题高亮颜色；普通消息定位仍使用默认主色。 */
  topicColorIndex?: number
  /** 高亮关键词 */
  highlightKeywords?: string[]
  /** 是否处于筛选模式（显示上下文按钮） */
  isFiltered?: boolean
}>()

const emit = defineEmits<{
  (e: 'view-context', messageId: number): void
  (e: 'update-alias', senderId: number, aliases: string[]): void
  (e: 'update-mark', messageId: number, mark: MessageMark | null): void
}>()

const sessionStore = useSessionStore()
const dataService = useDataService()
const toast = useToast()

// 判断当前消息是否是 Owner 发送的
const isOwner = computed(() => {
  const ownerId = sessionStore.currentSession?.ownerId
  if (!ownerId) return false
  return props.message.senderPlatformId === ownerId
})

// 基于发送者名称生成一致的颜色索引
const colorIndex = computed(() => {
  const name = props.message.senderName || ''
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash) % 16
})

// 现代优雅配色方案（16 种颜色）
// 参考 Linear, Notion 等现代产品的配色风格
const colorPalette = [
  { avatar: 'bg-rose-400 dark:bg-rose-500', name: 'text-rose-600 dark:text-rose-400' },
  { avatar: 'bg-pink-400 dark:bg-pink-500', name: 'text-pink-600 dark:text-pink-400' },
  { avatar: 'bg-fuchsia-400 dark:bg-fuchsia-500', name: 'text-fuchsia-600 dark:text-fuchsia-400' },
  { avatar: 'bg-purple-400 dark:bg-purple-500', name: 'text-purple-600 dark:text-purple-400' },
  { avatar: 'bg-violet-400 dark:bg-violet-500', name: 'text-violet-600 dark:text-violet-400' },
  { avatar: 'bg-indigo-400 dark:bg-indigo-500', name: 'text-indigo-600 dark:text-indigo-400' },
  { avatar: 'bg-blue-400 dark:bg-blue-500', name: 'text-blue-600 dark:text-blue-400' },
  { avatar: 'bg-sky-400 dark:bg-sky-500', name: 'text-sky-600 dark:text-sky-400' },
  { avatar: 'bg-cyan-400 dark:bg-cyan-500', name: 'text-cyan-600 dark:text-cyan-400' },
  { avatar: 'bg-teal-400 dark:bg-teal-500', name: 'text-teal-600 dark:text-teal-400' },
  { avatar: 'bg-emerald-400 dark:bg-emerald-500', name: 'text-emerald-600 dark:text-emerald-400' },
  { avatar: 'bg-green-400 dark:bg-green-500', name: 'text-green-600 dark:text-green-400' },
  { avatar: 'bg-lime-500 dark:bg-lime-600', name: 'text-lime-600 dark:text-lime-400' },
  { avatar: 'bg-amber-400 dark:bg-amber-500', name: 'text-amber-600 dark:text-amber-400' },
  { avatar: 'bg-orange-400 dark:bg-orange-500', name: 'text-orange-600 dark:text-orange-400' },
  { avatar: 'bg-red-400 dark:bg-red-500', name: 'text-red-600 dark:text-red-400' },
]

const currentColor = computed(() => colorPalette[colorIndex.value])
const avatarColor = computed(() => currentColor.value.avatar)
const nameColor = computed(() => currentColor.value.name)

// 气泡颜色
const bubbleColor = 'bg-gray-100/80 dark:bg-gray-800/80'
const targetColor = computed(() =>
  props.topicColorIndex === undefined
    ? 'bg-primary-500/5 dark:bg-primary-500/10'
    : chatTopicColorStyle(props.topicColorIndex).message
)
const showFullMessyContent = ref(false)
const aliasPopoverOpen = ref(false)
const aliasDraft = ref<string[]>([])
const { copy: copyMessage, copied } = useClipboard({ copiedDuring: 1500 })
const markPopoverOpen = ref(false)
const mark = ref<MessageMark | null>(props.message.mark)
const markLoading = ref(false)
const markCategories = ref<string[]>([])
const markColor = ref('')
const markComment = ref('')
const displayedComment = ref<HTMLElement | null>(null)
const commentExpanded = ref(false)
const commentOverflowing = ref(false)
const markColors = [
  { value: 'amber', class: 'bg-amber-400' },
  { value: 'rose', class: 'bg-rose-400' },
  { value: 'violet', class: 'bg-violet-400' },
  { value: 'blue', class: 'bg-blue-400' },
  { value: 'emerald', class: 'bg-emerald-400' },
  { value: 'gray', class: 'bg-gray-400' },
]
const markIndicatorClass = computed(() => {
  const classes: Record<string, string> = {
    amber: 'text-amber-500',
    rose: 'text-rose-500',
    violet: 'text-violet-500',
    blue: 'text-blue-500',
    emerald: 'text-emerald-500',
    gray: 'text-gray-500',
  }
  return classes[mark.value?.color || ''] || 'text-gray-500'
})

const contentAnalysis = computed(() => analyzeMessyContent(props.message.content || ''))
const visibleMessageContent = computed(() => {
  const analysis = contentAnalysis.value
  if (!analysis.shouldCollapse || showFullMessyContent.value) {
    return analysis.normalizedContent
  }
  return analysis.previewLines.join('\n')
})

watch(
  () => [props.message.id, props.message.content],
  () => {
    showFullMessyContent.value = false
  }
)

function findScrollContainer(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement
  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return parent
    parent = parent.parentElement
  }
  return null
}

async function toggleComment() {
  if (!commentOverflowing.value || !displayedComment.value) return
  const element = displayedComment.value
  const scrollContainer = findScrollContainer(element)
  const top = element.getBoundingClientRect().top
  commentExpanded.value = !commentExpanded.value
  await nextTick()
  requestAnimationFrame(() => {
    if (!scrollContainer || !displayedComment.value) return
    scrollContainer.scrollTop += displayedComment.value.getBoundingClientRect().top - top
  })
}

async function updateCommentOverflow() {
  await nextTick()
  const element = displayedComment.value
  if (!element || commentExpanded.value) return
  commentOverflowing.value = element.scrollHeight > element.clientHeight + 1
}

watch(
  [() => mark.value?.comment, displayedComment],
  () => {
    commentExpanded.value = false
    void updateCommentOverflow()
  },
  { flush: 'post' }
)

useResizeObserver(displayedComment, () => {
  void updateCommentOverflow()
})

watch(markPopoverOpen, (open) => {
  if (!open) return
  markCategories.value = [...(mark.value?.categories || [])]
  markColor.value = mark.value?.color || ''
  markComment.value = mark.value?.comment || ''
})

watch(
  () => [props.message.id, props.message.mark] as const,
  () => {
    mark.value = props.message.mark
  }
)

async function saveMark() {
  if (!props.sessionId) return
  markLoading.value = true
  try {
    const categories = [...new Set(markCategories.value.map((category) => category.trim()).filter(Boolean))]
    const color = markColor.value.trim()
    const comment = markComment.value.trim()
    const savedMark = await dataService.saveMessageMark(props.sessionId, props.message.id, {
      categories,
      color,
      comment,
    })
    mark.value = categories.length || color || comment ? savedMark : null
    emit('update-mark', props.message.id, mark.value)
    markPopoverOpen.value = false
  } catch (error) {
    toast.fail(t('records.messageItem.markSaveFailed'), { description: String(error) })
  } finally {
    markLoading.value = false
  }
}

async function removeMark() {
  markCategories.value = []
  markColor.value = ''
  markComment.value = ''
  await saveMark()
}

// 显示名称（包含别名）
const displayName = computed(() => {
  const name = props.message.senderName || ''
  const aliases = props.message.senderAliases || []

  // 如果有别名，在名称后面括号显示第一个别名
  if (aliases.length > 0) {
    return `${name}（${aliases[0]}）`
  }
  return name
})

function openAliasEditor() {
  aliasDraft.value = [...(props.message.senderAliases || [])]
}

function saveAliases(value: string[]) {
  const aliases = [...new Set(value.map((alias) => alias.trim()).filter(Boolean))]
  aliasDraft.value = aliases
  emit('update-alias', props.message.senderId, aliases)
}

// 获取头像字符（支持 emoji）
const avatarLetter = computed(() => {
  const name = props.message.senderName || ''
  if (!name) return '?'

  // 使用 Intl.Segmenter 正确分割字符串（包括 emoji）
  // 对于不支持的浏览器，使用 spread operator 作为 fallback
  try {
    const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' })
    const segments = [...segmenter.segment(name)]
    if (segments.length > 0) {
      return segments[0].segment
    }
  } catch {
    // Fallback: 使用 spread operator 处理 emoji
    const chars = [...name]
    if (chars.length > 0) {
      const firstChar = chars[0]
      // 检查是否是字母或汉字，如果是则转大写
      if (/^[a-zA-Z]$/.test(firstChar)) {
        return firstChar.toUpperCase()
      }
      return firstChar
    }
  }

  return '?'
})

const HIGHLIGHT_MARK_CLASS =
  'bg-transparent text-inherit underline decoration-primary-500/80 underline-offset-4 dark:decoration-primary-400/80'

function escapeHtml(content: string): string {
  return content.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return char
    }
  })
}

// 高亮关键词
function highlightContent(content: string): string {
  const escapedContent = escapeHtml(content)
  const escapedKeywords = props.highlightKeywords?.map((keyword) => escapeHtml(keyword)).filter(Boolean) ?? []
  if (!escapedKeywords.length || !escapedContent) return escapedContent

  const pattern = escapedKeywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const regex = new RegExp(`(${pattern})`, 'gi')
  return escapedContent.replace(regex, `<mark class="${HIGHLIGHT_MARK_CLASS}">$1</mark>`)
}
</script>

<template>
  <div
    class="group px-4 py-2.5 transition-all duration-300"
    :class="[isTarget ? targetColor : 'hover:bg-gray-50/40 dark:hover:bg-gray-900/10']"
  >
    <!-- Owner 消息显示在右侧 -->
    <div class="flex gap-3" :class="isOwner ? 'flex-row-reverse' : ''">
      <!-- 头像 -->
      <div
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-medium text-white overflow-hidden"
        :class="message.senderAvatar ? '' : avatarColor"
      >
        <img
          v-if="message.senderAvatar"
          :src="message.senderAvatar"
          :alt="message.senderName"
          class="h-full w-full object-cover"
        />
        <span v-else>{{ avatarLetter }}</span>
      </div>

      <!-- 消息内容区 -->
      <div class="min-w-0 flex-1" :class="isOwner ? 'flex flex-col items-end' : ''">
        <!-- 发送者名称 -->
        <div class="mb-1 flex items-center gap-1" :class="isOwner ? 'flex-row-reverse' : ''">
          <span class="text-sm font-medium" :class="nameColor">
            {{ displayName }}
          </span>
          <UPopover v-model:open="aliasPopoverOpen">
            <button
              type="button"
              class="flex size-5 items-center justify-center rounded text-gray-400 opacity-0 transition hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              :title="t('records.messageItem.editAlias')"
              :aria-label="t('records.messageItem.editAlias')"
              @click="openAliasEditor"
            >
              <UIcon name="i-heroicons-pencil-square" class="size-3.5" />
            </button>
            <template #content>
              <div class="w-64 p-2">
                <MemberAliasInput v-model="aliasDraft" size="sm" @update:model-value="saveAliases" />
              </div>
            </template>
          </UPopover>
        </div>

        <!-- 气泡和上下文按钮 -->
        <!-- max-w-[calc(100%-48px)] = 100% - 头像宽度(36px) - gap(12px) -->
        <div class="flex min-w-0 max-w-[calc(100%-68px)] items-start gap-1" :class="isOwner ? 'flex-row-reverse' : ''">
          <div class="min-w-0 max-w-full">
            <div
              class="relative min-w-0 max-w-full rounded-2xl border border-gray-100 px-3.5 py-2.5 transition-all duration-300 dark:border-gray-800/40"
              :class="bubbleColor"
            >
              <!-- 回复引用样式 -->
              <div
                v-if="message.replyToMessageId"
                class="mb-2 border-l-2 border-pink-400 dark:border-pink-500 pl-2.5 py-1 text-xs text-gray-500 dark:text-gray-400 bg-gray-500/5 dark:bg-white/5 rounded-r"
              >
                <span class="font-medium text-gray-600 dark:text-gray-300">{{ t('records.messageItem.replyTo') }}</span>
                <span v-if="message.replyToSenderName" class="ml-1 font-semibold text-gray-700 dark:text-gray-200">
                  {{ message.replyToSenderName }}
                </span>
                <p
                  v-if="message.replyToContent"
                  class="mt-1 line-clamp-2 italic text-gray-500 dark:text-gray-400 leading-normal"
                >
                  {{ message.replyToContent }}
                </p>
              </div>
              <p
                class="chat-record-message-content whitespace-pre-wrap break-all text-sm text-gray-700 dark:text-gray-200"
                v-html="highlightContent(visibleMessageContent)"
              />
              <ul
                v-if="contentAnalysis.linkUrls.length"
                class="chat-record-message-content mt-2 min-w-0 max-w-full list-disc space-y-1 pl-4 text-xs text-primary-600 dark:text-primary-400"
              >
                <li v-for="linkUrl in contentAnalysis.linkUrls" :key="linkUrl" class="min-w-0">
                  <a
                    :href="linkUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="block min-w-0 max-w-full truncate transition-colors hover:text-primary-700 dark:hover:text-primary-300"
                    @click.stop
                  >
                    {{ linkUrl }}
                  </a>
                </li>
              </ul>
              <button
                v-if="contentAnalysis.shouldCollapse"
                type="button"
                class="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gray-500 transition-colors select-none hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer"
                @click="showFullMessyContent = !showFullMessyContent"
              >
                <UIcon
                  :name="showFullMessyContent ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'"
                  class="h-3.5 w-3.5"
                />
                <span>
                  {{
                    showFullMessyContent
                      ? t('records.messageItem.collapseMessyContent')
                      : t('records.messageItem.expandMessyContent')
                  }}
                </span>
              </button>
            </div>
            <div
              v-if="mark?.comment"
              class="mt-1.5 flex min-w-0 max-w-full items-start gap-1.5 px-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400"
              :class="commentOverflowing ? 'cursor-pointer' : ''"
              @click="toggleComment"
            >
              <UIcon name="i-heroicons-chat-bubble-bottom-center-text" class="mt-0.5 size-3.5 shrink-0" />
              <div class="min-w-0 max-w-full">
                <p
                  ref="displayedComment"
                  class="max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                  :class="commentExpanded ? '' : 'max-h-[25vh] overflow-hidden'"
                >
                  {{ mark.comment }}
                </p>
                <UIcon
                  v-if="commentOverflowing"
                  :name="commentExpanded ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'"
                  class="mx-auto mt-1 block size-3.5"
                />
              </div>
            </div>
          </div>

          <!-- 上下文查看按钮 -->
          <UPopover v-if="!IS_WEB_WASM" v-model:open="markPopoverOpen">
            <button
              type="button"
              class="mt-1 flex h-6 w-6 items-center justify-center rounded-lg transition-all duration-200 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-95 cursor-pointer"
              :class="
                mark
                  ? `${markIndicatorClass} opacity-100`
                  : 'text-gray-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
              "
              :title="t('records.messageItem.mark')"
              :aria-label="t('records.messageItem.mark')"
            >
              <UIcon :name="mark?.color ? 'i-heroicons-bookmark-solid' : 'i-heroicons-bookmark'" class="h-4 w-4" />
            </button>
            <template #content>
              <div class="w-80 space-y-4 p-4">
                <div class="space-y-1.5">
                  <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">
                    {{ t('records.messageItem.markCategoryLabel') }}
                  </label>
                  <TagInput v-model="markCategories" size="sm" :placeholder="t('records.messageItem.markCategory')" />
                </div>
                <div class="space-y-1.5">
                  <span class="block text-xs font-medium text-gray-600 dark:text-gray-300">
                    {{ t('records.messageItem.markColor') }}
                  </span>
                  <div class="flex flex-wrap gap-2" role="group" :aria-label="t('records.messageItem.markColor')">
                    <button
                      v-for="color in markColors"
                      :key="color.value"
                      type="button"
                      class="size-6 rounded-full border-2"
                      :class="[
                        color.class,
                        markColor === color.value ? 'border-gray-900 dark:border-white' : 'border-transparent',
                      ]"
                      :aria-label="t(`records.markColors.${color.value}`)"
                      :aria-pressed="markColor === color.value"
                      @click="markColor = markColor === color.value ? '' : color.value"
                    />
                  </div>
                </div>
                <div class="space-y-1.5">
                  <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">
                    {{ t('records.messageItem.markComment') }}
                  </label>
                  <UTextarea
                    v-model="markComment"
                    :placeholder="t('records.messageItem.markCommentPlaceholder')"
                    autoresize
                    :rows="3"
                    :maxrows="8"
                    class="w-full"
                    :ui="{ base: 'max-h-40 overflow-y-auto' }"
                  />
                </div>
                <div class="flex justify-end gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
                  <UButton v-if="mark" color="error" variant="soft" :disabled="markLoading" @click="removeMark">
                    {{ t('records.messageItem.removeMark') }}
                  </UButton>
                  <UButton :loading="markLoading" @click="saveMark">
                    {{ t('records.messageItem.saveMark') }}
                  </UButton>
                </div>
              </div>
            </template>
          </UPopover>
          <button
            v-if="message.content"
            type="button"
            class="mt-1 flex h-6 w-6 items-center justify-center rounded-lg opacity-0 transition-all duration-200 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-pink-500 dark:hover:text-pink-400 active:scale-95 group-hover:opacity-100 focus:opacity-100 cursor-pointer"
            :title="t(copied ? 'records.messageItem.copied' : 'records.messageItem.copy')"
            :aria-label="t(copied ? 'records.messageItem.copied' : 'records.messageItem.copy')"
            @click="copyMessage(message.content)"
          >
            <UIcon :name="copied ? 'i-heroicons-check' : 'i-heroicons-clipboard'" class="h-4 w-4" />
          </button>
          <button
            v-if="isFiltered"
            type="button"
            class="mt-1 flex h-6 w-6 items-center justify-center rounded-lg opacity-0 transition-all duration-200 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-pink-500 dark:hover:text-pink-400 active:scale-95 group-hover:opacity-100 cursor-pointer"
            :title="t('records.messageItem.viewContext')"
            @click="$emit('view-context', message.id)"
          >
            <UIcon name="i-heroicons-chat-bubble-left-ellipsis" class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
