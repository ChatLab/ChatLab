<script setup lang="ts">
/**
 * 单条消息展示组件 - 气泡样式
 * 支持 Owner 消息显示在右侧（类似聊天界面）
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ChatRecordMessage } from './types'
import { useSessionStore } from '@/stores/session'

const { t } = useI18n()

const props = defineProps<{
  /** 消息数据 */
  message: ChatRecordMessage
  /** 是否为目标消息（需要高亮） */
  isTarget?: boolean
  /** 高亮关键词 */
  highlightKeywords?: string[]
  /** 是否处于筛选模式（显示上下文按钮） */
  isFiltered?: boolean
}>()

const emit = defineEmits<{
  (e: 'view-context', messageId: number): void
}>()

const sessionStore = useSessionStore()

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

// 气泡颜色（Owner 使用绿色，其他人使用灰色）
const bubbleColor = computed(() =>
  isOwner.value ? 'bg-green-100 dark:bg-green-900/40' : 'bg-gray-100 dark:bg-gray-800'
)

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

// 高亮关键词
function highlightContent(content: string): string {
  if (!props.highlightKeywords?.length || !content) return content

  const pattern = props.highlightKeywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const regex = new RegExp(`(${pattern})`, 'gi')
  return content.replace(
    regex,
    '<mark class="bg-transparent border-b-2 border-yellow-400 dark:border-yellow-500">$1</mark>'
  )
}
</script>

<template>
  <div
    class="group px-4 py-2 transition-colors"
    :class="{
      'bg-yellow-50/50 dark:bg-yellow-900/10': isTarget,
    }"
  >
    <!-- Owner 消息显示在右侧 -->
    <div class="flex gap-3" :class="isOwner ? 'flex-row-reverse' : ''">
      <!-- 头像 -->
      <div
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white overflow-hidden"
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
        <div class="mb-1 flex items-center gap-2" :class="isOwner ? 'flex-row-reverse' : ''">
          <span class="text-sm font-medium" :class="nameColor">
            {{ displayName }}
          </span>
        </div>

        <!-- 气泡和上下文按钮 -->
        <!-- max-w-[calc(100%-48px)] = 100% - 头像宽度(36px) - gap(12px) -->
        <div class="flex items-start gap-1 max-w-[calc(100%-68px)]" :class="isOwner ? 'flex-row-reverse' : ''">
          <div
            class="relative inline-block rounded-lg px-3 py-2 transition-shadow"
            :class="[bubbleColor, isTarget ? 'ring-2 ring-yellow-400 dark:ring-yellow-500' : '']"
          >
            <!-- 回复引用样式 -->
            <div
              v-if="message.replyToMessageId"
              class="mb-2 border-l-2 border-gray-300 dark:border-gray-600 pl-2 text-xs text-gray-500 dark:text-gray-400"
            >
              <span class="font-medium">{{ t('records.messageItem.replyTo') }}</span>
              <span v-if="message.replyToSenderName" class="ml-1 text-gray-600 dark:text-gray-300">
                {{ message.replyToSenderName }}
              </span>
              <p v-if="message.replyToContent" class="mt-0.5 line-clamp-2 italic">
                {{ message.replyToContent }}
              </p>
            </div>
            <p
              class="whitespace-pre-wrap break-all text-sm text-gray-700 dark:text-gray-200"
              v-html="highlightContent(message.content || '')"
            />
          </div>

          <!-- 上下文查看按钮 -->
          <button
            v-if="isFiltered"
            class="mt-1 flex h-6 w-6 items-center justify-center rounded opacity-0 transition-opacity hover:bg-gray-200 group-hover:opacity-100 dark:hover:bg-gray-700"
            :title="t('records.messageItem.viewContext')"
            @click="$emit('view-context', message.id)"
          >
            <UIcon name="i-heroicons-chat-bubble-left-ellipsis" class="h-4 w-4 text-gray-400" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
