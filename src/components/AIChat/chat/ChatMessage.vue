<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import MarkdownIt from 'markdown-it'
import type { ContentBlock, ToolBlockContent } from '@/composables/useAIChat'
import CaptureButton from '@/components/common/CaptureButton.vue'
import ErrorBlock from './ErrorBlock.vue'
import ChartBlockRenderer from './ChartBlockRenderer.vue'
import EvidenceBlock from './EvidenceBlock.vue'
import CrossChatEvidenceBlock from './CrossChatEvidenceBlock.vue'
import ProcessDisclosure from './ProcessDisclosure.vue'
import ProcessDisclosureIcon from './ProcessDisclosureIcon.vue'
import { useToast } from '@/composables/useToast'
import { stripChartImagePlaceholders } from '@/services/ai/chartMarkdownPlaceholders'
import { shouldHideRecoverableChartError } from '@/stores/aiChatChartBlocks'
import type { AIEntityRef, ToolProgress } from '@openchatlab/shared-types'
import LiveFollowText from './LiveFollowText.vue'
import { getFirstLine, getLatestLine } from './liveFollowText'
import {
  buildProcessSegments,
  findRepresentativeProcessThought,
  formatProcessDuration,
  getProcessSegmentDurationMs,
  getVisibleSegmentBlocks,
  isActiveProcessSegment,
  resolveProcessHeaderActivity,
  resolveProcessElapsedMs,
  type ProcessSegment,
} from './chatMessageProcessSegments'

const { t, te, locale } = useI18n()
const toast = useToast()

// Props
const props = defineProps<{
  messageId?: string
  role: 'user' | 'assistant' | 'summary'
  content: string
  timestamp: number
  isStreaming?: boolean
  processDurationMs?: number
  /** AI 消息的混合内容块（按时序排列的文本和工具调用） */
  contentBlocks?: ContentBlock[]
  /** 是否显示截屏按钮（仅 AI 回复） */
  showCaptureButton?: boolean
  editable?: boolean
  /** Live tool status for the streaming process header. */
  activeTool?: {
    name: string
    displayName: string
    status: 'running' | 'done' | 'error'
    progress?: ToolProgress
  } | null
  entityRefs?: AIEntityRef[]
}>()

const emit = defineEmits<{
  edit: [payload: { messageId: string; content: string }]
  fork: [messageId: string]
}>()

// 格式化时间：当天只显示时刻，非当天补上月日，跨年再带年份
const formattedTime = computed(() => {
  const time = dayjs(props.timestamp)
  if (time.isSame(dayjs(), 'day')) {
    return time.format('HH:mm')
  }

  const useChineseDate = locale.value.startsWith('zh') || locale.value.startsWith('ja')
  if (time.isSame(dayjs(), 'year')) {
    return time.format(useChineseDate ? 'M月D日 HH:mm' : 'M/D HH:mm')
  }
  return time.format(useChineseDate ? 'YYYY年M月D日 HH:mm' : 'YYYY/M/D HH:mm')
})

// 是否是用户消息
const isUser = computed(() => props.role === 'user')
const isSummary = computed(() => props.role === 'summary')
const isEditing = ref(false)
const editContent = ref(props.content)
const editTextareaRef = ref<HTMLTextAreaElement | null>(null)
const canEdit = computed(() => isUser.value && props.editable && !props.isStreaming && !!props.messageId)
const canFork = computed(() => !isUser.value && !isSummary.value && !props.isStreaming && !!props.messageId)

// 创建 markdown-it 实例
const md = new MarkdownIt({
  html: false, // 禁用 HTML 标签
  breaks: true, // 将换行转为 <br>
  linkify: true, // 自动将 URL 转为链接
  typographer: true, // 启用排版优化
})

md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return self.renderToken(tokens, idx, options)
}

// 渲染 Markdown 文本
const MAX_MARKDOWN_CACHE_ENTRIES = 32
const markdownCache = new Map<string, string>()

function renderMarkdown(text: string): string {
  if (!text) return ''

  const cached = markdownCache.get(text)
  if (cached !== undefined) {
    markdownCache.delete(text)
    markdownCache.set(text, cached)
    return cached
  }

  const rendered = md.render(text)
  markdownCache.set(text, rendered)
  if (markdownCache.size > MAX_MARKDOWN_CACHE_ENTRIES) {
    const oldest = markdownCache.keys().next().value
    if (oldest !== undefined) markdownCache.delete(oldest)
  }
  return rendered
}

// 思考标签名称映射
function getThinkLabel(tag: string): string {
  const normalized = tag?.toLowerCase() || 'think'
  if (normalized === 'analysis') return t('ai.chat.message.think.labels.analysis')
  if (normalized === 'reasoning') return t('ai.chat.message.think.labels.reasoning')
  if (normalized === 'reflection') return t('ai.chat.message.think.labels.reflection')
  if (normalized === 'plan_validation') return t('ai.chat.message.think.labels.planValidation')
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
  return md.render(getDisplayText(props.content))
})

watch(
  () => props.content,
  (content) => {
    if (!isEditing.value) editContent.value = content
  }
)

function syncEditTextareaHeight() {
  const el = editTextareaRef.value
  if (!el) return
  el.style.height = 'auto'
  const maxHeight = 384
  const nextHeight = Math.min(el.scrollHeight, maxHeight)
  el.style.height = `${nextHeight}px`
  el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

async function startEditing() {
  if (!canEdit.value) return
  editContent.value = props.content
  isEditing.value = true
  await nextTick()
  syncEditTextareaHeight()
  editTextareaRef.value?.focus()
}

function cancelEditing() {
  isEditing.value = false
  editContent.value = props.content
}

function submitEditing() {
  if (!props.messageId) return
  const content = editContent.value.trim()
  if (!content || content === props.content.trim()) {
    cancelEditing()
    return
  }
  isEditing.value = false
  emit('edit', { messageId: props.messageId, content })
}

function getDisplayText(text: string): string {
  return stripChartImagePlaceholders(text)
}

// 过滤无内容的文本/思考块，避免显示空气泡
const visibleBlocks = computed(() => {
  const blocks = props.contentBlocks || []
  return blocks.filter((block, index) => {
    if (block.type === 'text') {
      return getDisplayText(block.text).trim().length > 0
    }
    if (block.type === 'think') {
      return block.text.trim().length > 0
    }
    if (block.type === 'error') {
      return !shouldHideRecoverableChartError(blocks, index, { isStreaming: props.isStreaming })
    }
    return true
  })
})

function isFoldableProcessBlock(block: ContentBlock): boolean {
  return (
    block.type === 'think' ||
    block.type === 'tool' ||
    block.type === 'skill' ||
    block.type === 'plan' ||
    block.type === 'plan_draft' ||
    block.type === 'error'
  )
}

function isTextBlock(block: ContentBlock): boolean {
  return block.type === 'text'
}

// Text may be emitted between tool rounds, so only a completed tool-free turn can end this state.
const isAgentRunActive = computed(() => Boolean(props.isStreaming) && props.processDurationMs === undefined)

const renderSegments = computed(() =>
  buildProcessSegments(visibleBlocks.value, {
    isFoldableProcessBlock,
    isTextBlock,
    mode: isAgentRunActive.value ? 'timeline' : 'completed',
  })
)

const recordedProcessDurationMs = computed(() =>
  renderSegments.value.reduce((total, segment) => total + getProcessSegmentDurationMs(segment, getBlockDurationMs), 0)
)

const processElapsedMs = computed(() =>
  resolveProcessElapsedMs({
    isStreaming: isAgentRunActive.value,
    liveElapsedMs: 0,
    settledElapsedMs: props.processDurationMs ?? 0,
    recordedElapsedMs: recordedProcessDurationMs.value,
  })
)

const copyableBlocks = computed(() => getVisibleSegmentBlocks(renderSegments.value))

const processSegmentOpenOverrides = ref<Record<string, boolean>>({})

function getSegmentBlocks(segment: ProcessSegment<ContentBlock>): ContentBlock[] {
  return segment.type === 'process' ? segment.blocks : [segment.block]
}

function getProcessSegmentKey(segmentIndex: number): string {
  return `${props.messageId ?? props.timestamp}:process:${segmentIndex}`
}

function isProcessSegmentOpen(segmentIndex: number): boolean {
  const key = getProcessSegmentKey(segmentIndex)
  const override = processSegmentOpenOverrides.value[key]
  if (override !== undefined) return override
  return hasProcessSegmentError(renderSegments.value[segmentIndex])
}

function toggleProcessSegment(segmentIndex: number): void {
  const key = getProcessSegmentKey(segmentIndex)
  processSegmentOpenOverrides.value = {
    ...processSegmentOpenOverrides.value,
    [key]: !isProcessSegmentOpen(segmentIndex),
  }
}

function isLastVisibleBlock(block: ContentBlock): boolean {
  return visibleBlocks.value[visibleBlocks.value.length - 1] === block
}

function isProcessingProcessSegment(segmentIndex: number): boolean {
  return isActiveProcessSegment(renderSegments.value, segmentIndex, isAgentRunActive.value)
}

function isCompletedProcessSummary(segment: ProcessSegment<ContentBlock>): boolean {
  return segment.type === 'process' && !isAgentRunActive.value
}

function getProcessSegmentStepCount(segment: ProcessSegment<ContentBlock>): number {
  if (segment.type !== 'process') return 0
  return segment.blocks.filter(isFoldableProcessBlock).length
}

function getProcessSegmentStepLabel(segment: ProcessSegment<ContentBlock>): string {
  const count = getProcessSegmentStepCount(segment)
  const key = count === 1 ? 'ai.chat.message.process.step' : 'ai.chat.message.process.steps'
  return t(key, { count })
}

function hasProcessSegmentError(segment: ProcessSegment<ContentBlock> | undefined): boolean {
  if (segment?.type !== 'process') return false
  return segment.blocks.some(
    (block) => block.type === 'error' || (block.type === 'tool' && block.tool.status === 'error')
  )
}

function getBlockDurationMs(block: ContentBlock): number {
  if (block.type === 'think') return block.durationMs ?? 0
  if (block.type === 'tool') return block.tool.durationMs ?? 0
  return 0
}

function getLastFoldableProcessBlock(
  segment: ProcessSegment<ContentBlock>
): Extract<ContentBlock, { type: 'tool' | 'think' | 'skill' | 'plan' | 'plan_draft' | 'error' }> | undefined {
  if (segment.type !== 'process') return undefined
  for (let index = segment.blocks.length - 1; index >= 0; index -= 1) {
    const block = segment.blocks[index]
    if (isFoldableProcessBlock(block)) {
      return block as Extract<ContentBlock, { type: 'tool' | 'think' | 'skill' | 'plan' | 'plan_draft' | 'error' }>
    }
  }
  return undefined
}

function getRepresentativeThinkBlock(segment: ProcessSegment<ContentBlock>) {
  return segment.type === 'process' ? findRepresentativeProcessThought(segment.blocks) : undefined
}

function getProcessHeaderActivity(segment: ProcessSegment<ContentBlock>, segmentIndex: number) {
  const lastFoldable = getLastFoldableProcessBlock(segment)
  return resolveProcessHeaderActivity({
    isActive: isProcessingProcessSegment(segmentIndex),
    activeToolName: props.activeTool?.status === 'running' ? props.activeTool.name : undefined,
    activeToolProgressPhase: props.activeTool?.status === 'running' ? props.activeTool.progress?.phase : undefined,
    lastFoldable: lastFoldable
      ? {
          kind: lastFoldable.type,
          name:
            lastFoldable.type === 'tool'
              ? lastFoldable.tool.name
              : lastFoldable.type === 'skill'
                ? lastFoldable.skillName
                : undefined,
        }
      : undefined,
  })
}

function getProcessHeaderTitle(segment: ProcessSegment<ContentBlock>, segmentIndex: number): string {
  if (isCompletedProcessSummary(segment)) {
    if (hasProcessSegmentError(segment)) return t('ai.chat.message.process.failed')
    return t('ai.chat.message.process.duration', {
      duration: formatProcessDuration(processElapsedMs.value, locale.value),
    })
  }

  if (!isProcessingProcessSegment(segmentIndex)) {
    const thinkBlock = getRepresentativeThinkBlock(segment)
    if (thinkBlock) return getThinkLabel(thinkBlock.tag)
    return t('ai.chat.message.process.label')
  }

  const activity = getProcessHeaderActivity(segment, segmentIndex)
  if (activity.type === 'tool') {
    if (props.activeTool?.status === 'running' && props.activeTool.name === activity.name) {
      return getToolDisplayName(props.activeTool)
    }
    const toolBlock =
      segment.type === 'process'
        ? segment.blocks.find((block) => block.type === 'tool' && block.tool.name === activity.name)
        : undefined
    return toolBlock?.type === 'tool' ? getToolDisplayName(toolBlock.tool) : activity.name
  }
  if (activity.type === 'think') return t('ai.chat.message.think.loading')
  if (activity.type === 'skill') return t('ai.skill.active.label', { name: activity.name })
  if (activity.type === 'plan') return t('ai.chat.message.process.planning')
  return t('ai.chat.message.process.working')
}

function getProcessHeaderMeta(segment: ProcessSegment<ContentBlock>, segmentIndex: number): string {
  if (isCompletedProcessSummary(segment)) return ''

  if (isProcessingProcessSegment(segmentIndex)) {
    const activity = getProcessHeaderActivity(segment, segmentIndex)
    if (activity.type === 'tool' && activity.progressPhase) {
      const key = `ai.chat.thinking.toolProgress.${activity.progressPhase}`
      return te(key) ? t(key) : ''
    }
    return ''
  }

  return getProcessSegmentStepLabel(segment)
}

function getProcessHeaderPreview(segment: ProcessSegment<ContentBlock>, segmentIndex: number): string {
  if (segment.type !== 'process') return ''
  if (isCompletedProcessSummary(segment)) return ''

  if (!isProcessingProcessSegment(segmentIndex)) {
    const thinkBlock = getRepresentativeThinkBlock(segment)
    return thinkBlock ? getFirstLine(thinkBlock.text) : ''
  }

  if (props.activeTool?.status === 'running') return ''

  for (let index = segment.blocks.length - 1; index >= 0; index -= 1) {
    const block = segment.blocks[index]
    if (block.type === 'think' || block.type === 'plan_draft' || block.type === 'text') {
      const line = getLatestLine(block.text)
      if (line) return line
    }
  }

  return ''
}

function getProcessHeaderIcon(segment: ProcessSegment<ContentBlock>, segmentIndex: number): string {
  if (hasProcessSegmentError(segment)) return 'i-heroicons-exclamation-circle'

  if (!isProcessingProcessSegment(segmentIndex)) {
    return getRepresentativeThinkBlock(segment) ? 'i-heroicons-light-bulb' : 'i-heroicons-queue-list'
  }

  const activity = getProcessHeaderActivity(segment, segmentIndex)
  if (activity.type === 'tool') return 'i-heroicons-wrench-screwdriver'
  if (activity.type === 'think') return 'i-heroicons-light-bulb'
  if (activity.type === 'skill') return 'i-heroicons-bolt'
  if (activity.type === 'plan') return 'i-heroicons-clipboard-document-list'
  return 'i-heroicons-sparkles'
}

function isLiveThinkBlock(block: ContentBlock): boolean {
  return block.type === 'think' && !!props.isStreaming && !block.durationMs
}

// 是否使用 contentBlocks 渲染（AI 消息且有内容块）
const useBlocksRendering = computed(() => {
  return props.role === 'assistant' && visibleBlocks.value.length > 0
})

function getToolDisplayName(tool: ToolBlockContent): string {
  return te(`ai.assistant.builtinToolDesc.${tool.name}`)
    ? t(`ai.assistant.builtinToolDesc.${tool.name}`)
    : tool.displayName
}

function formatToolStatusForCopy(status: ToolBlockContent['status']): string {
  if (status === 'running') return 'running'
  if (status === 'done') return 'done'
  return 'error'
}

function getToolResultText(tool: ToolBlockContent): string {
  return tool.displayResult ?? tool.result ?? ''
}

function hasToolResult(tool: ToolBlockContent): boolean {
  return tool.status !== 'running' && getToolResultText(tool).trim().length > 0
}

function isToolResultDisplayTruncated(tool: ToolBlockContent): boolean {
  return !tool.displayResult && (tool.result ?? '').includes('…[truncated]')
}

async function copyToolResult(tool: ToolBlockContent) {
  const text = getToolResultText(tool)
  if (!text.trim()) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('ai.chat.message.toolResult.copySuccess'))
  } catch (error) {
    toast.fail(t('ai.chat.message.toolResult.copyFailed'), { description: String(error) })
  }
}

function formatPlanTools(tools: string[]): string {
  if (tools.length === 0) return t('ai.chat.message.plan.noTools')
  return tools.join(', ')
}

function parsePlanValidation(text: string): {
  title?: string
  steps: Array<{ goal: string; suggestedTools: string[]; evidenceNeeded: string }>
  successCriteria: string[]
} | null {
  try {
    const parsed = JSON.parse(text.trim()) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    const steps = Array.isArray(record.steps)
      ? record.steps
          .filter((step): step is Record<string, unknown> => !!step && typeof step === 'object')
          .map((step) => ({
            goal: typeof step.goal === 'string' ? step.goal : '',
            suggestedTools: Array.isArray(step.suggestedTools)
              ? step.suggestedTools.filter((tool): tool is string => typeof tool === 'string')
              : [],
            evidenceNeeded: typeof step.evidenceNeeded === 'string' ? step.evidenceNeeded : '',
          }))
          .filter((step) => step.goal)
      : []
    return {
      title: typeof record.title === 'string' ? record.title : undefined,
      steps,
      successCriteria: Array.isArray(record.successCriteria)
        ? record.successCriteria.filter((item): item is string => typeof item === 'string')
        : [],
    }
  } catch {
    return null
  }
}

const planValidationCache = new Map<string, NonNullable<ReturnType<typeof parsePlanValidation>>>()

function getPlanValidation(text: string): ReturnType<typeof parsePlanValidation> {
  const cached = planValidationCache.get(text)
  if (cached) return cached
  const parsed = parsePlanValidation(text)
  if (parsed) planValidationCache.set(text, parsed)
  return parsed
}

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

  if (name === 'render_chart') {
    const spec = params.spec && typeof params.spec === 'object' ? (params.spec as Record<string, unknown>) : null
    const parts = [spec?.title, spec?.type].filter(
      (part): part is string => typeof part === 'string' && part.length > 0
    )
    return parts.join(' | ')
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

  if (name === 'semantic_search_current_chat') {
    const query = typeof params.query === 'string' ? params.query : ''
    if (!query) return ''
    return query.length > 40 ? `“${query.slice(0, 40)}…”` : `“${query}”`
  }

  // 通用兜底方案：展示最多3个非空参数
  const genericParts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    const strVal = typeof value === 'object' ? JSON.stringify(value) : String(value)
    const displayVal = strVal.length > 30 ? strVal.substring(0, 30) + '...' : strVal
    genericParts.push(`${key}: ${displayVal}`)
    if (genericParts.length >= 3) {
      genericParts.push('...')
      break
    }
  }

  return genericParts.join(' | ')
}

const copyMarkdownText = computed(() => {
  if (!useBlocksRendering.value && props.content.trim()) return getDisplayText(props.content)
  if (!useBlocksRendering.value) return ''

  const lines = copyableBlocks.value
    .map((block) => {
      if (block.type === 'text') {
        return getDisplayText(block.text)
      }

      if (block.type === 'think') {
        const thinkTitle = getThinkLabel(block.tag)
        const thinkBody = block.text
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n')
        return `> ${thinkTitle}\n>\n${thinkBody}`
      }

      if (block.type === 'skill') {
        return `> ${t('ai.skill.active.label', { name: block.skillName })}`
      }

      if (block.type === 'chart') {
        return `> Chart: ${block.chart.spec.title}`
      }

      if (block.type === 'evidence') {
        const header = `> ${t('ai.chat.evidence.title')}`
        const groupLines = block.evidence.groups.map((group) => {
          const status = t(`ai.chat.evidence.group.${group.status}`)
          const sources = group.sources.map((source) => `>   - ${source.snippet}`).join('\n')
          return `> [${status}] ${group.title}\n${sources}`
        })
        return [header, ...groupLines].join('\n')
      }

      if (block.type === 'cross_chat_evidence') {
        const sourceLines = block.evidence.sources.map(
          (source) => `> - ${source.sessionName} · ${source.senderName}: ${source.snippet}`
        )
        return [`> ${t('ai.chat.crossChatEvidence.title')}`, ...sourceLines].join('\n')
      }

      if (block.type === 'plan') {
        const steps = block.plan.steps
          .map(
            (step, index) =>
              `${index + 1}. ${step.goal}\n   - ${t('ai.chat.message.plan.evidenceNeeded')}: ${step.evidenceNeeded}\n   - ${t('ai.chat.message.plan.suggestedTools')}: ${formatPlanTools(step.suggestedTools)}`
          )
          .join('\n')
        const criteria = block.plan.successCriteria.map((item) => `- ${item}`).join('\n')
        const displayText = block.displayText
          ? `${block.displayText
              .split('\n')
              .map((line) => `> ${line}`)
              .join('\n')}\n\n`
          : ''
        if (block.displayText) {
          return `> ${t('ai.chat.message.plan.label')}: ${block.plan.title}\n\n${displayText.trimEnd()}`
        }
        return `> ${t('ai.chat.message.plan.label')}: ${block.plan.title}\n\n${steps}\n\n${t('ai.chat.message.plan.successCriteria')}:\n${criteria}`
      }

      if (block.type === 'plan_draft') {
        return `> ${t('ai.chat.message.plan.label')}\n>\n${block.text
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n')}`
      }

      if (block.type === 'tool') {
        const toolName = getToolDisplayName(block.tool)
        const toolParams = formatToolParams(block.tool)
        const paramsSuffix = toolParams ? ` (${toolParams})` : ''
        return `- [${formatToolStatusForCopy(block.tool.status)}] ${toolName}${paramsSuffix}`
      }

      return ''
    })
    .filter((line) => line.trim().length > 0)

  return lines.join('\n\n')
})

const canCopyMarkdown = computed(() => !props.isStreaming && copyMarkdownText.value.trim().length > 0)

async function handleCopyMarkdown() {
  if (!canCopyMarkdown.value) return

  try {
    await navigator.clipboard.writeText(copyMarkdownText.value)
    toast.success(t('ai.chat.message.copy.success'))
  } catch (error) {
    toast.fail(t('ai.chat.message.copy.failed'), { description: String(error) })
  }
}
</script>

<template>
  <div
    class="flex items-start gap-3"
    :class="[isUser && !isEditing ? 'flex-row-reverse' : '', isSummary ? 'justify-center' : '']"
  >
    <!-- 消息内容 -->
    <div
      class="group/message"
      :class="[isUser && !isEditing ? 'flex max-w-[85%] min-w-0 flex-col items-end' : 'w-full min-w-0']"
    >
      <!-- System 消息：可折叠的上下文总结 -->
      <template v-if="isSummary">
        <details
          class="w-full rounded-lg border border-gray-200 bg-gray-50/80 dark:border-gray-700/50 dark:bg-gray-800/40"
        >
          <summary
            class="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs font-medium text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <UIcon name="i-heroicons-arrow-path" class="h-3.5 w-3.5 shrink-0" />
            <span>{{ t('ai.chat.message.summary.label') }}</span>
            <UIcon name="i-heroicons-chevron-right" class="ml-auto h-3 w-3 transition-transform [[open]>&]:rotate-90" />
          </summary>
          <div class="border-t border-gray-200/60 px-3 py-2.5 dark:border-gray-700/40">
            <div
              class="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed text-gray-600 dark:text-gray-300"
              v-html="renderedContent"
            />
            <p class="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
              {{ t('ai.chat.message.summary.info') }}
            </p>
          </div>
        </details>
      </template>

      <!-- 用户消息：简单气泡 -->
      <template v-else-if="isUser">
        <div v-if="isEditing" class="rounded-2xl bg-gray-100 p-4 text-gray-900 dark:bg-gray-800 dark:text-gray-100">
          <textarea
            ref="editTextareaRef"
            v-model="editContent"
            rows="2"
            class="w-full resize-none rounded-xl border border-primary-200 bg-white/90 px-4 py-3 text-sm leading-relaxed outline-none focus:border-primary-400 dark:border-primary-400/40 dark:bg-page-dark/70"
            @input="syncEditTextareaHeight"
            @keydown.esc.prevent="cancelEditing"
            @keydown.ctrl.enter.prevent="submitEditing"
            @keydown.meta.enter.prevent="submitEditing"
          />
          <div class="mt-2 flex justify-end">
            <div class="flex gap-2">
              <UButton size="xs" variant="ghost" color="gray" @click="cancelEditing">
                {{ t('common.cancel') }}
              </UButton>
              <UButton size="xs" color="primary" @click="submitEditing">
                {{ t('ai.chat.message.edit.submit') }}
              </UButton>
            </div>
          </div>
        </div>
        <div
          v-else
          class="ai-user-bubble w-fit max-w-full rounded-3xl bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
        >
          <div v-if="entityRefs?.length" class="mb-1.5 flex flex-wrap gap-1.5">
            <span
              v-for="entity in entityRefs"
              :key="entity.type === 'contact' ? `contact:${entity.contactKey}` : `session:${entity.sessionId}`"
              class="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-xs text-primary-600 dark:bg-white/10 dark:text-primary-300"
            >
              <UIcon
                :name="entity.type === 'contact' ? 'i-heroicons-user' : 'i-heroicons-user-group'"
                class="h-3 w-3"
              />
              {{ entity.displayName }}
            </span>
          </div>
          <div class="prose prose-sm dark:prose-invert max-w-none" v-html="renderedContent" />
        </div>
      </template>

      <!-- AI 消息：混合内容块布局 -->
      <template v-else-if="useBlocksRendering">
        <div :class="isAgentRunActive ? 'space-y-2' : 'space-y-3'">
          <template v-for="(segment, segmentIdx) in renderSegments" :key="segmentIdx">
            <div>
              <button
                v-if="segment.type === 'process'"
                type="button"
                class="ai-live-row group/process flex h-6 w-full min-w-0 max-w-full items-center text-left text-sm leading-6 text-gray-500 transition-colors hover:text-gray-700 focus:outline-none focus-visible:bg-gray-50 dark:text-gray-400 dark:hover:text-gray-200 dark:focus-visible:bg-gray-800/30"
                :data-running="isProcessingProcessSegment(segmentIdx) || undefined"
                :aria-expanded="isProcessSegmentOpen(segmentIdx)"
                @click="toggleProcessSegment(segmentIdx)"
              >
                <span
                  v-if="!isCompletedProcessSummary(segment) || hasProcessSegmentError(segment)"
                  class="relative mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center"
                >
                  <UIcon
                    v-if="isProcessSegmentOpen(segmentIdx)"
                    name="i-heroicons-chevron-down"
                    class="h-3.5 w-3.5 text-gray-500 dark:text-gray-400"
                  />
                  <template v-else>
                    <UIcon
                      :name="getProcessHeaderIcon(segment, segmentIdx)"
                      class="absolute h-3.5 w-3.5 text-gray-400 transition-opacity duration-100 group-hover/process:opacity-0 dark:text-gray-500"
                      :class="[hasProcessSegmentError(segment) ? 'text-amber-500 dark:text-amber-400' : '']"
                    />
                    <UIcon
                      name="i-heroicons-chevron-down"
                      class="absolute h-3.5 w-3.5 text-gray-500 opacity-0 transition-opacity duration-100 group-hover/process:opacity-100 dark:text-gray-400"
                    />
                  </template>
                </span>
                <span
                  class="shrink-0"
                  :class="
                    hasProcessSegmentError(segment)
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-gray-600 dark:text-gray-300'
                  "
                >
                  {{ getProcessHeaderTitle(segment, segmentIdx) }}
                </span>
                <UIcon
                  v-if="isCompletedProcessSummary(segment) && !hasProcessSegmentError(segment)"
                  :name="isProcessSegmentOpen(segmentIdx) ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'"
                  class="ml-1 h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400"
                />
                <template v-if="!isProcessSegmentOpen(segmentIdx) && getProcessHeaderPreview(segment, segmentIdx)">
                  <span
                    class="mx-2 h-0.5 w-0.5 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600"
                    aria-hidden="true"
                  />
                  <LiveFollowText
                    :text="getProcessHeaderPreview(segment, segmentIdx)"
                    :follow-end="isProcessingProcessSegment(segmentIdx)"
                  />
                </template>
                <span
                  v-if="getProcessHeaderMeta(segment, segmentIdx)"
                  class="shrink-0 text-xs text-gray-400 dark:text-gray-500"
                  :class="[
                    !isProcessSegmentOpen(segmentIdx) && getProcessHeaderPreview(segment, segmentIdx)
                      ? 'ml-3'
                      : 'ml-1.5',
                  ]"
                >
                  <span v-if="isProcessSegmentOpen(segmentIdx) || !getProcessHeaderPreview(segment, segmentIdx)">
                    ·
                  </span>
                  {{ getProcessHeaderMeta(segment, segmentIdx) }}
                </span>
              </button>

              <div
                :class="segment.type === 'process' ? 'ai-process-fold' : ''"
                :data-open="segment.type !== 'process' || isProcessSegmentOpen(segmentIdx) ? true : undefined"
              >
                <div :class="segment.type === 'process' ? 'ai-process-fold-inner' : ''">
                  <div
                    :class="[
                      segment.type === 'process'
                        ? [
                            'ai-process-fold-content',
                            isCompletedProcessSummary(segment)
                              ? 'pt-2.5 space-y-1.5'
                              : 'ml-1.5 pt-1 space-y-0.5 border-l border-gray-200/80 pl-3 dark:border-white/10',
                          ]
                        : '',
                    ]"
                  >
                    <template v-for="(block, blockIdx) in getSegmentBlocks(segment)" :key="`${segmentIdx}-${blockIdx}`">
                      <!-- 文本块 -->
                      <div
                        v-if="block.type === 'text'"
                        class="text-gray-900 dark:text-gray-100"
                        :class="[
                          segment.type === 'process'
                            ? isCompletedProcessSummary(segment)
                              ? 'py-2'
                              : 'py-1 text-xs text-gray-500 dark:text-gray-400'
                            : isAgentRunActive
                              ? 'py-1'
                              : '',
                        ]"
                      >
                        <div
                          class="prose dark:prose-invert max-w-none"
                          :class="[
                            segment.type === 'process' && !isCompletedProcessSummary(segment)
                              ? 'prose-sm leading-relaxed'
                              : 'ai-chat-prose',
                          ]"
                          v-html="renderMarkdown(getDisplayText(block.text))"
                        />
                        <!-- 流式输出光标（只在最后一个文本块显示） -->
                        <span
                          v-if="isStreaming && isLastVisibleBlock(block)"
                          class="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-gray-800 dark:bg-gray-200"
                        />
                      </div>

                      <!-- 思考块（默认折叠） -->
                      <ProcessDisclosure
                        v-else-if="block.type === 'think'"
                        class="w-full text-sm text-gray-500 dark:text-gray-400"
                      >
                        <template #summary="{ open, toggle }">
                          <button
                            type="button"
                            class="ai-live-row group/process-toggle flex w-full min-w-0 cursor-pointer select-none items-center text-left transition-colors hover:text-gray-700 dark:hover:text-gray-300"
                            :class="[
                              isCompletedProcessSummary(segment) ? 'h-7 text-sm leading-7' : 'h-6 text-sm leading-6',
                            ]"
                            :data-running="isLiveThinkBlock(block) || undefined"
                            :aria-expanded="open"
                            @click="toggle"
                          >
                            <ProcessDisclosureIcon icon="i-heroicons-light-bulb" :open="open" class="mr-1.5" />
                            <span class="shrink-0 text-gray-600 dark:text-gray-300">
                              {{ getThinkLabel(block.tag) }}
                            </span>
                            <span
                              v-if="
                                !open &&
                                block.tag?.toLowerCase() !== 'plan_validation' &&
                                (getFirstLine(block.text) || isLiveThinkBlock(block))
                              "
                              class="mx-2 h-0.5 w-0.5 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600"
                              aria-hidden="true"
                            />
                            <LiveFollowText
                              v-if="!open && block.tag?.toLowerCase() !== 'plan_validation'"
                              :text="isLiveThinkBlock(block) ? getLatestLine(block.text) : getFirstLine(block.text)"
                              :follow-end="isLiveThinkBlock(block)"
                            />
                            <span
                              v-if="block.durationMs"
                              class="ml-3 shrink-0 text-xs text-gray-400 dark:text-gray-500"
                            >
                              {{ formatThinkDuration(block.durationMs) }}
                            </span>
                          </button>
                        </template>
                        <div
                          class="prose prose-sm ai-process-detail-content ai-thought-content dark:prose-invert mt-1 max-w-none pl-[22px]"
                        >
                          <template v-if="block.tag === 'plan_validation' && getPlanValidation(block.text)">
                            <div
                              v-if="getPlanValidation(block.text)?.title"
                              class="mb-2 font-medium text-gray-700 dark:text-gray-200"
                            >
                              {{ getPlanValidation(block.text)?.title }}
                            </div>
                            <ol class="not-prose space-y-2 text-xs leading-relaxed">
                              <li
                                v-for="(step, stepIndex) in getPlanValidation(block.text)?.steps"
                                :key="stepIndex"
                                class="text-gray-600 dark:text-gray-300"
                              >
                                <div class="font-medium text-gray-800 dark:text-gray-200">
                                  {{ step.goal }}
                                </div>
                                <div v-if="step.evidenceNeeded" class="mt-1 text-gray-500 dark:text-gray-400">
                                  {{ t('ai.chat.message.plan.evidenceNeeded') }}: {{ step.evidenceNeeded }}
                                </div>
                                <div class="mt-0.5 text-gray-500 dark:text-gray-400">
                                  {{ t('ai.chat.message.plan.suggestedTools') }}:
                                  {{ formatPlanTools(step.suggestedTools) }}
                                </div>
                              </li>
                            </ol>
                            <div
                              v-if="getPlanValidation(block.text)?.successCriteria.length"
                              class="not-prose mt-2 border-t border-gray-100 pt-2 dark:border-gray-800"
                            >
                              <div class="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                                {{ t('ai.chat.message.plan.successCriteria') }}
                              </div>
                              <ul
                                class="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-gray-600 dark:text-gray-300"
                              >
                                <li
                                  v-for="(criterion, criterionIndex) in getPlanValidation(block.text)?.successCriteria"
                                  :key="criterionIndex"
                                >
                                  {{ criterion }}
                                </li>
                              </ul>
                            </div>
                          </template>
                          <div v-else v-html="renderMarkdown(block.text)" />
                        </div>
                      </ProcessDisclosure>

                      <!-- 技能块 -->
                      <div
                        v-else-if="block.type === 'skill'"
                        class="flex items-center gap-2 font-medium text-gray-600 dark:text-gray-300"
                        :class="[isCompletedProcessSummary(segment) ? 'h-7 text-sm leading-7' : 'py-1 text-xs']"
                      >
                        <UIcon name="i-heroicons-bolt" class="h-3.5 w-3.5 shrink-0 text-gray-400" />
                        <span>{{ t('ai.skill.active.label', { name: block.skillName }) }}</span>
                      </div>

                      <!-- 计划块 -->
                      <ProcessDisclosure
                        v-else-if="block.type === 'plan'"
                        class="group w-full text-sm text-gray-600 dark:text-gray-400"
                      >
                        <template #summary="{ open, toggle }">
                          <button
                            type="button"
                            class="group/process-toggle flex w-full cursor-pointer select-none items-center gap-2 rounded-md text-left text-gray-500 transition-colors hover:bg-gray-50/80 hover:text-gray-700 dark:hover:bg-gray-800/30 dark:hover:text-gray-300"
                            :class="[isCompletedProcessSummary(segment) ? 'h-7 text-sm leading-7' : 'py-1 text-xs']"
                            :aria-expanded="open"
                            @click="toggle"
                          >
                            <ProcessDisclosureIcon icon="i-heroicons-clipboard-document-list" :open="open" />
                            <span class="min-w-0 truncate text-gray-600 dark:text-gray-300">
                              {{ t('ai.chat.message.plan.label') }} · {{ block.plan.title }}
                            </span>
                          </button>
                        </template>
                        <div class="mt-2 pl-[22px] text-sm leading-6">
                          <div
                            v-if="block.displayText"
                            class="prose prose-sm ai-process-detail-content dark:prose-invert max-w-none text-gray-600 dark:text-gray-300"
                            v-html="renderMarkdown(block.displayText)"
                          />
                          <ol v-else class="space-y-2">
                            <li
                              v-for="(step, stepIndex) in block.plan.steps"
                              :key="stepIndex"
                              class="text-sm leading-6"
                            >
                              <div class="font-medium text-gray-800 dark:text-gray-200">
                                {{ stepIndex + 1 }}. {{ step.goal }}
                              </div>
                              <div class="mt-1 text-gray-500 dark:text-gray-400">
                                {{ t('ai.chat.message.plan.evidenceNeeded') }}: {{ step.evidenceNeeded }}
                              </div>
                              <div class="mt-0.5 text-gray-500 dark:text-gray-400">
                                {{ t('ai.chat.message.plan.suggestedTools') }}:
                                {{ formatPlanTools(step.suggestedTools) }}
                              </div>
                            </li>
                          </ol>
                          <div
                            v-if="!block.displayText"
                            class="mt-2 border-t border-gray-100 pt-2 dark:border-gray-800"
                          >
                            <div class="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                              {{ t('ai.chat.message.plan.successCriteria') }}
                            </div>
                            <ul
                              class="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-gray-600 dark:text-gray-300"
                            >
                              <li
                                v-for="(criterion, criterionIndex) in block.plan.successCriteria"
                                :key="criterionIndex"
                              >
                                {{ criterion }}
                              </li>
                            </ul>
                          </div>
                        </div>
                      </ProcessDisclosure>

                      <!-- 计划草稿块 -->
                      <div
                        v-else-if="block.type === 'plan_draft'"
                        class="py-1 text-sm text-gray-600 dark:text-gray-400"
                      >
                        <div class="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300">
                          <UIcon
                            name="i-heroicons-clipboard-document-list"
                            class="h-3.5 w-3.5 shrink-0 text-gray-400"
                          />
                          <span>{{ t('ai.chat.message.plan.label') }}</span>
                          <span v-if="isStreaming" class="text-[11px] font-normal text-gray-400 dark:text-gray-500">
                            {{ t('ai.chat.message.process.planning') }}
                          </span>
                        </div>
                        <div
                          class="mt-2 prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed text-gray-600 dark:text-gray-300"
                          v-html="renderMarkdown(block.text)"
                        />
                      </div>

                      <!-- 图表块 -->
                      <ChartBlockRenderer v-else-if="block.type === 'chart'" :chart="block.chart" />

                      <!-- 证据块 -->
                      <EvidenceBlock v-else-if="block.type === 'evidence'" :evidence="block.evidence" />

                      <CrossChatEvidenceBlock
                        v-else-if="block.type === 'cross_chat_evidence'"
                        :evidence="block.evidence"
                      />

                      <!-- 工具块：有结果时可展开查看发送给 AI 的安全文本 -->
                      <ProcessDisclosure
                        v-else-if="block.type === 'tool' && hasToolResult(block.tool)"
                        class="group w-full max-w-full"
                      >
                        <template #summary="{ open, toggle }">
                          <button
                            type="button"
                            class="group/process-toggle flex w-full cursor-pointer select-none items-center gap-2 rounded-md text-left text-gray-500 transition-colors hover:bg-gray-50/80 dark:text-gray-400 dark:hover:bg-gray-800/30"
                            :class="[
                              isCompletedProcessSummary(segment) ? 'h-7 text-sm leading-7' : 'py-1 text-xs',
                              block.tool.status === 'error' ? 'text-amber-700 dark:text-amber-400' : '',
                            ]"
                            :aria-expanded="open"
                            @click="toggle"
                          >
                            <ProcessDisclosureIcon
                              :icon="
                                block.tool.status === 'error'
                                  ? 'i-heroicons-exclamation-circle'
                                  : 'i-heroicons-wrench-screwdriver'
                              "
                              :open="open"
                              :icon-class="
                                block.tool.status === 'error' ? 'text-amber-500' : 'text-gray-400 dark:text-gray-500'
                              "
                            />
                            <span
                              class="shrink-0"
                              :class="[
                                block.tool.status === 'error'
                                  ? 'text-amber-700 dark:text-amber-300'
                                  : 'text-gray-600 dark:text-gray-300',
                              ]"
                            >
                              {{ getToolDisplayName(block.tool) }}
                            </span>
                            <span
                              v-if="formatToolParams(block.tool)"
                              class="min-w-0 truncate text-xs text-gray-400 dark:text-gray-500"
                            >
                              {{ formatToolParams(block.tool) }}
                            </span>
                            <span class="ml-auto shrink-0 text-xs text-gray-400 dark:text-gray-500">
                              {{ t('ai.chat.message.toolResult.view') }}
                            </span>
                          </button>
                        </template>
                        <div
                          class="mx-px mt-1 overflow-hidden rounded-lg border border-gray-200/60 bg-gray-50/80 dark:border-white/5 dark:bg-white/[0.03]"
                        >
                          <div
                            class="flex items-center justify-between gap-2 border-b border-gray-200/60 px-3 py-2 dark:border-white/5"
                          >
                            <span class="text-xs font-medium text-gray-500 dark:text-gray-400">
                              {{ t('ai.chat.message.toolResult.title') }}
                            </span>
                            <UButton
                              size="xs"
                              variant="ghost"
                              color="primary"
                              icon="i-heroicons-document-duplicate"
                              :title="t('ai.chat.message.toolResult.copy')"
                              @click.stop="copyToolResult(block.tool)"
                            />
                          </div>
                          <div
                            v-if="isToolResultDisplayTruncated(block.tool)"
                            class="border-b border-amber-200/70 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300"
                          >
                            {{ t('ai.chat.message.toolResult.displayTruncated') }}
                          </div>
                          <pre
                            class="ai-tool-result-scroll whitespace-pre-wrap break-words px-3 py-2.5 text-xs leading-relaxed text-gray-700 dark:text-gray-200"
                            >{{ getToolResultText(block.tool) }}</pre
                          >
                        </div>
                      </ProcessDisclosure>

                      <!-- 工具块：运行中或无结果时保持紧凑展示 -->
                      <div
                        v-else-if="block.type === 'tool'"
                        class="ai-live-row flex min-w-0 items-center gap-2"
                        :data-running="block.tool.status === 'running' || undefined"
                        :class="[
                          isCompletedProcessSummary(segment) ? 'h-7 text-sm leading-7' : 'py-1 text-xs',
                          block.tool.status === 'error'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-gray-500 dark:text-gray-400',
                        ]"
                      >
                        <UIcon
                          :name="
                            block.tool.status === 'running'
                              ? 'i-heroicons-arrow-path'
                              : block.tool.status === 'error'
                                ? 'i-heroicons-exclamation-circle'
                                : 'i-heroicons-wrench-screwdriver'
                          "
                          class="h-3.5 w-3.5 shrink-0"
                          :class="[
                            block.tool.status === 'running'
                              ? 'animate-spin text-primary-500'
                              : block.tool.status === 'error'
                                ? 'text-amber-500'
                                : 'text-gray-400',
                          ]"
                        />
                        <span
                          class="shrink-0"
                          :class="[
                            block.tool.status === 'error'
                              ? 'text-amber-700 dark:text-amber-300'
                              : 'text-gray-600 dark:text-gray-300',
                          ]"
                        >
                          {{ getToolDisplayName(block.tool) }}
                        </span>
                        <span
                          v-if="formatToolParams(block.tool)"
                          class="min-w-0 truncate text-xs text-gray-400 dark:text-gray-500"
                        >
                          {{ formatToolParams(block.tool) }}
                        </span>
                        <span
                          v-if="block.tool.status === 'done' && block.tool.durationMs"
                          class="ml-auto shrink-0 text-xs text-gray-400 dark:text-gray-500"
                        >
                          {{ formatThinkDuration(block.tool.durationMs) }}
                        </span>
                      </div>

                      <!-- 错误块 -->
                      <ErrorBlock
                        v-else-if="block.type === 'error'"
                        :error="block.error"
                        :compact="segment.type === 'process'"
                      />
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </template>

      <!-- AI 消息：传统纯文本渲染（向后兼容） -->
      <template v-else>
        <div class="py-1 text-gray-900 dark:text-gray-100">
          <div class="prose ai-chat-prose dark:prose-invert max-w-none" v-html="renderedContent" />
          <span
            v-if="isStreaming"
            class="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-gray-800 dark:bg-gray-200"
          />
        </div>
      </template>

      <!-- 时间戳 + 操作按钮（summary 消息和流式输出中不显示） -->
      <div v-if="!isSummary && !isStreaming" class="ai-message-actions mt-1 flex items-center gap-2 px-1">
        <UTooltip :text="t('ai.chat.message.copy.tooltip')" class="no-capture">
          <UButton
            icon="i-heroicons-document-duplicate"
            variant="ghost"
            color="neutral"
            size="xs"
            :disabled="!canCopyMarkdown"
            @click="handleCopyMarkdown"
          />
        </UTooltip>
        <UTooltip v-if="canEdit" :text="t('ai.chat.message.edit.tooltip')" class="no-capture">
          <UButton icon="i-heroicons-pencil-square" variant="ghost" color="neutral" size="xs" @click="startEditing" />
        </UTooltip>
        <UTooltip v-if="canFork" :text="t('ai.chat.message.fork.tooltip')" class="no-capture">
          <UButton
            icon="i-heroicons-arrow-top-right-on-square"
            variant="ghost"
            color="neutral"
            size="xs"
            @click="emit('fork', messageId!)"
          />
        </UTooltip>
        <!-- 截屏按钮（仅 AI 回复显示） -->
        <CaptureButton
          v-if="showCaptureButton && !isUser && !isStreaming"
          size="xs"
          color="neutral"
          type="element"
          target-selector=".qa-pair"
          markdown-fix
          capture-frame
          :progressive-narrowing="true"
        />
        <span
          class="max-w-0 overflow-hidden text-xs whitespace-nowrap text-gray-400 opacity-0 transition-[max-width,opacity] duration-150 group-hover/message:max-w-[12rem] group-hover/message:opacity-100 group-focus-within/message:max-w-[12rem] group-focus-within/message:opacity-100"
        >
          {{ formattedTime }}
        </span>
      </div>
    </div>
  </div>
</template>

<style>
.ai-user-bubble {
  padding: 10px 16px;
}

.ai-user-bubble .prose {
  font-size: 16px;
  line-height: 24px;
}

.ai-message-actions button {
  color: rgb(107 114 128) !important;
}

.ai-message-actions button:hover:not(:disabled) {
  color: rgb(55 65 81) !important;
  background-color: rgb(243 244 246);
}

.dark .ai-message-actions button {
  color: rgb(156 163 175) !important;
}

.dark .ai-message-actions button:hover:not(:disabled) {
  color: rgb(229 231 235) !important;
  background-color: rgb(31 41 55);
}

.ai-live-row {
  position: relative;
  overflow: hidden;
}

.ai-live-row[data-running]::after {
  content: '';
  position: absolute;
  inset-block: 0;
  left: 0;
  width: 300px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in srgb, var(--color-page-bg) 60%, transparent) 55%,
    transparent 100%
  );
  animation: ai-live-row-sweep 2.5s ease-in-out infinite;
  pointer-events: none;
}

.dark .ai-live-row[data-running]::after {
  background: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in srgb, var(--color-page-dark) 60%, transparent) 55%,
    transparent 100%
  );
}

@keyframes ai-live-row-sweep {
  0% {
    left: -300px;
  }
  80%,
  100% {
    left: 100%;
  }
}

.ai-process-fold {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 200ms ease-out;
}

.ai-process-fold[data-open] {
  grid-template-rows: 1fr;
}

.ai-process-fold-inner {
  min-height: 0;
  overflow: hidden;
  visibility: hidden;
  transition: visibility 0s linear 200ms;
}

.ai-process-fold[data-open] > .ai-process-fold-inner {
  visibility: visible;
  transition-delay: 0s;
}

.ai-tool-result-scroll {
  max-height: min(18rem, 40vh);
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.prose.ai-process-detail-content {
  font-size: 0.875rem;
  line-height: 1.5rem;
}

.prose.ai-thought-content {
  line-height: 1.2rem;
}

@media (prefers-reduced-motion: reduce) {
  .ai-live-row[data-running]::after {
    animation: none;
  }

  .ai-process-fold {
    transition: none;
  }
}
</style>
