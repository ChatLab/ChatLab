<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import MarkdownIt from 'markdown-it'
import type { ContentBlock, ToolBlockContent } from '@/composables/useAIChat'
import CaptureButton from '@/components/common/CaptureButton.vue'

const { t, te, locale } = useI18n()

// Props
const props = defineProps<{
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  isStreaming?: boolean
  /** AI 消息的混合内容块（按时序排列的文本和工具调用） */
  contentBlocks?: ContentBlock[]
  /** 是否显示截屏按钮（仅 AI 回复） */
  showCaptureButton?: boolean
}>()

// 格式化时间
const formattedTime = computed(() => {
  return dayjs(props.timestamp).format('HH:mm')
})

// 是否是用户消息
const isUser = computed(() => props.role === 'user')

// 创建 markdown-it 实例
const md = new MarkdownIt({
  html: false, // 禁用 HTML 标签
  breaks: true, // 将换行转为 <br>
  linkify: true, // 自动将 URL 转为链接
  typographer: true, // 启用排版优化
})

// 渲染 Markdown 文本
function renderMarkdown(text: string): string {
  if (!text) return ''
  return md.render(text)
}

// 思考标签名称映射
function getThinkLabel(tag: string): string {
  const normalized = tag?.toLowerCase() || 'think'
  if (normalized === 'analysis') return t('ai.chat.message.think.labels.analysis')
  if (normalized === 'reasoning') return t('ai.chat.message.think.labels.reasoning')
  if (normalized === 'reflection') return t('ai.chat.message.think.labels.reflection')
  if (normalized === 'think' || normalized === 'thought' || normalized === 'thinking') {
    return t('ai.chat.message.think.labels.think')
  }
  return t('ai.chat.message.think.labels.other', { tag })
}

// 格式化思考耗时（毫秒 -> 秒）
function formatThinkDuration(durationMs?: number): string {
  if (!durationMs) return ''
  const seconds = (durationMs / 1000).toFixed(1)
  return t('ai.chat.message.think.duration', { seconds })
}

// 渲染后的 HTML（用于用户消息或纯文本 AI 消息）
const renderedContent = computed(() => {
  if (!props.content) return ''
  return md.render(props.content)
})

// 过滤无内容的文本/思考块，避免显示空气泡
const visibleBlocks = computed(() => {
  const blocks = props.contentBlocks || []
  return blocks.filter((block) => {
    if (block.type === 'text' || block.type === 'think') {
      return block.text.trim().length > 0
    }
    return true
  })
})

// 是否使用 contentBlocks 渲染（AI 消息且有内容块）
const useBlocksRendering = computed(() => {
  return props.role === 'assistant' && visibleBlocks.value.length > 0
})

// 格式化时间参数显示
function formatTimeParams(params: Record<string, unknown>): string {
  // 优先使用 start_time/end_time
  if (params.start_time || params.end_time) {
    const start = params.start_time ? String(params.start_time) : ''
    const end = params.end_time ? String(params.end_time) : ''
    if (start && end) {
      return `${start} ~ ${end}`
    }
    return start || end
  }

  // 使用 year/month/day/hour 组合
  if (params.year) {
    if (locale.value.startsWith('zh')) {
      let result = `${params.year}年`
      if (params.month) {
        result += `${params.month}月`
        if (params.day) {
          result += `${params.day}日`
          if (params.hour !== undefined) {
            result += ` ${params.hour}点`
          }
        }
      }
      return result
    } else {
      // English format
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      let result = ''
      if (params.month) {
        result = monthNames[(params.month as number) - 1] || String(params.month)
        if (params.day) {
          result += ` ${params.day}`
          if (params.hour !== undefined) {
            const hour = params.hour as number
            const suffix = hour >= 12 ? 'pm' : 'am'
            const hour12 = hour % 12 || 12
            result += `, ${hour12}${suffix}`
          }
        }
        result += `, ${params.year}`
      } else {
        result = String(params.year)
      }
      return result
    }
  }

  return ''
}

// 格式化工具参数显示
function formatToolParams(tool: ToolBlockContent): string {
  if (!tool.params) return ''

  const name = tool.name
  const params = tool.params

  if (name === 'search_messages') {
    const keywords = params.keywords as string[] | undefined
    const parts: string[] = []

    if (keywords && keywords.length > 0) {
      parts.push(`${t('ai.chat.message.toolParams.keywords')}: ${keywords.join(', ')}`)
    }

    const timeStr = formatTimeParams(params)
    if (timeStr) {
      parts.push(`${t('ai.chat.message.toolParams.time')}: ${timeStr}`)
    }

    return parts.join(' | ')
  }

  if (name === 'get_recent_messages') {
    const parts: string[] = []
    parts.push(t('ai.chat.message.toolParams.getMessages', { count: params.limit || 100 }))

    const timeStr = formatTimeParams(params)
    if (timeStr) {
      parts.push(timeStr)
    }

    return parts.join(' | ')
  }

  if (name === 'get_conversation_between') {
    const parts: string[] = []

    const timeStr = formatTimeParams(params)
    if (timeStr) {
      parts.push(`${t('ai.chat.message.toolParams.time')}: ${timeStr}`)
    }

    if (params.limit) {
      parts.push(t('ai.chat.message.toolParams.limit', { count: params.limit }))
    }

    return parts.join(' | ')
  }

  if (name === 'get_message_context') {
    const ids = params.message_ids as number[] | undefined
    const size = params.context_size || 20
    if (ids && ids.length > 0) {
      return t('ai.chat.message.toolParams.contextWithMessages', { msgCount: ids.length, contextSize: size })
    }
    return t('ai.chat.message.toolParams.context', { size })
  }

  if (name === 'get_member_stats') {
    return t('ai.chat.message.toolParams.topMembers', { count: params.top_n || 10 })
  }

  if (name === 'get_time_stats') {
    const typeKey = params.type as string
    return t(`ai.chat.message.toolParams.timeStats.${typeKey}`) || String(params.type)
  }

  if (name === 'get_members') {
    if (params.search) {
      return `${t('ai.chat.message.toolParams.search')}: ${params.search}`
    }
    return t('ai.chat.message.toolParams.getMemberList')
  }

  if (name === 'get_member_name_history') {
    return `${t('ai.chat.message.toolParams.memberId')}: ${params.member_id}`
  }

  return ''
}
</script>

<template>
  <div class="flex items-start gap-3" :class="[isUser ? 'flex-row-reverse' : '']">
    <!-- 消息内容 -->
    <div class="max-w-[85%] min-w-0">
      <!-- 用户消息：简单气泡 -->
      <template v-if="isUser">
        <div class="rounded-3xl bg-primary-50 px-5 py-3 text-gray-900 dark:bg-primary-500/50 dark:text-gray-100">
          <div class="prose prose-sm dark:prose-invert max-w-none leading-relaxed" v-html="renderedContent" />
        </div>
      </template>

      <!-- AI 消息：混合内容块布局 -->
      <template v-else-if="useBlocksRendering">
        <div class="space-y-3">
          <template v-for="(block, idx) in visibleBlocks" :key="idx">
            <!-- 文本块 -->
            <div v-if="block.type === 'text'" class="py-1 text-gray-900 dark:text-gray-100">
              <div
                class="prose prose-sm dark:prose-invert max-w-none leading-relaxed"
                v-html="renderMarkdown(block.text)"
              />
              <!-- 流式输出光标（只在最后一个文本块显示） -->
              <span
                v-if="isStreaming && idx === visibleBlocks.length - 1"
                class="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-gray-800 dark:bg-gray-200"
              />
            </div>

            <!-- 思考块（默认折叠） -->
            <details
              v-else-if="block.type === 'think'"
              class="mb-2 border-l-2 border-gray-200 pl-4 py-1 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400"
            >
              <summary
                class="cursor-pointer select-none text-xs font-medium transition-colors hover:text-gray-700 dark:hover:text-gray-300"
              >
                {{ getThinkLabel(block.tag) }}
                <span v-if="block.durationMs" class="ml-2 text-xs text-gray-400 dark:text-gray-500">
                  {{ formatThinkDuration(block.durationMs) }}
                </span>
                <span
                  v-if="isStreaming && idx === visibleBlocks.length - 1"
                  class="ml-2 inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500"
                >
                  <span>{{ t('ai.chat.message.think.loading') }}</span>
                  <span class="flex gap-0.5">
                    <span class="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
                    <span class="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                    <span class="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
                  </span>
                </span>
              </summary>
              <div class="mt-2 prose prose-sm dark:prose-invert max-w-none leading-relaxed text-xs">
                <div v-html="renderMarkdown(block.text)" />
              </div>
            </details>

            <!-- 技能块 -->
            <div
              v-else-if="block.type === 'skill'"
              class="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 dark:bg-gray-800/50 dark:text-gray-400"
            >
              <UIcon name="i-heroicons-bolt" class="h-3.5 w-3.5" />
              <span>{{ t('ai.skill.active.label', { name: block.skillName }) }}</span>
            </div>

            <!-- 工具块 -->
            <div
              v-else-if="block.type === 'tool'"
              class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
              :class="[
                block.tool.status === 'running'
                  ? 'bg-gray-50 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400'
                  : block.tool.status === 'done'
                    ? 'bg-gray-50 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400'
                    : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400',
              ]"
            >
              <!-- 状态图标 -->
              <UIcon
                :name="
                  block.tool.status === 'running'
                    ? 'i-heroicons-arrow-path'
                    : block.tool.status === 'done'
                      ? 'i-heroicons-check-circle'
                      : 'i-heroicons-x-circle'
                "
                class="h-4 w-4 shrink-0"
                :class="[
                  block.tool.status === 'running'
                    ? 'animate-spin text-gray-500 dark:text-gray-400'
                    : block.tool.status === 'done'
                      ? 'text-gray-400 dark:text-gray-500'
                      : 'text-red-500',
                ]"
              />
              <!-- 工具信息 -->
              <div class="min-w-0 flex-1">
                <!-- 调用前缀 -->
                <span class="text-xs text-gray-400 dark:text-gray-500 mr-1">{{ t('ai.chat.message.calling') }}</span>
                <span class="font-medium text-gray-700 dark:text-gray-300">
                  {{
                    te(`ai.chat.message.tools.${block.tool.name}`)
                      ? t(`ai.chat.message.tools.${block.tool.name}`)
                      : block.tool.displayName
                  }}
                </span>
                <span v-if="formatToolParams(block.tool)" class="ml-2 text-xs text-gray-500 dark:text-gray-400">
                  {{ formatToolParams(block.tool) }}
                </span>
              </div>
            </div>
          </template>

          <!-- 流式处理中指示器（当最后一个块是已完成的工具块时显示） -->
          <div
            v-if="isStreaming && visibleBlocks.length > 0 && visibleBlocks[visibleBlocks.length - 1].type === 'tool'"
            class="flex items-center gap-2 px-1 py-2 text-sm text-gray-500 dark:text-gray-400"
          >
            <span class="flex gap-1">
              <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
              <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
              <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
            </span>
            <span>{{ t('ai.chat.message.generating') }}</span>
          </div>
        </div>
      </template>

      <!-- AI 消息：传统纯文本渲染（向后兼容） -->
      <template v-else>
        <div class="py-1 text-gray-900 dark:text-gray-100">
          <div class="prose prose-sm dark:prose-invert max-w-none leading-relaxed" v-html="renderedContent" />
          <span
            v-if="isStreaming"
            class="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-gray-800 dark:bg-gray-200"
          />
        </div>
      </template>

      <!-- 时间戳 + 操作按钮 -->
      <div class="mt-1 flex items-center gap-2 px-1" :class="[isUser ? 'flex-row-reverse' : '']">
        <span class="text-xs text-gray-400">{{ formattedTime }}</span>
        <!-- 截屏按钮（仅 AI 回复显示） -->
        <CaptureButton
          v-if="showCaptureButton && !isUser && !isStreaming"
          size="xs"
          type="element"
          target-selector=".qa-pair"
        />
      </div>
    </div>
  </div>
</template>

<!-- Markdown 样式已提取到全局 src/assets/styles/markdown.css -->
