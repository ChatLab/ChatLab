import type { ChatTopicAssignmentMode, ChatTopicTimeRange } from '@openchatlab/shared-types'

export interface ChatTopicHighlight {
  messageIds: number[]
  timeRanges: ChatTopicTimeRange[]
  assignmentMode: ChatTopicAssignmentMode
  colorIndex: number
}

export const CHAT_TOPIC_COLOR_STYLES = [
  {
    dot: 'bg-pink-400 dark:bg-pink-500',
    text: 'text-pink-500 dark:text-pink-400',
    selectedCard: 'border-pink-400 bg-pink-50/50 dark:border-pink-700 dark:bg-pink-950/20',
    message: 'bg-pink-500/10 dark:bg-pink-500/15',
  },
  {
    dot: 'bg-blue-400 dark:bg-blue-500',
    text: 'text-blue-500 dark:text-blue-400',
    selectedCard: 'border-blue-400 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-950/20',
    message: 'bg-blue-500/10 dark:bg-blue-500/15',
  },
  {
    dot: 'bg-violet-400 dark:bg-violet-500',
    text: 'text-violet-500 dark:text-violet-400',
    selectedCard: 'border-violet-400 bg-violet-50/50 dark:border-violet-700 dark:bg-violet-950/20',
    message: 'bg-violet-500/10 dark:bg-violet-500/15',
  },
  {
    dot: 'bg-amber-400 dark:bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    selectedCard: 'border-amber-400 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/20',
    message: 'bg-amber-500/10 dark:bg-amber-500/15',
  },
  {
    dot: 'bg-emerald-400 dark:bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    selectedCard: 'border-emerald-400 bg-emerald-50/50 dark:border-emerald-700 dark:bg-emerald-950/20',
    message: 'bg-emerald-500/10 dark:bg-emerald-500/15',
  },
  {
    dot: 'bg-cyan-400 dark:bg-cyan-500',
    text: 'text-cyan-600 dark:text-cyan-400',
    selectedCard: 'border-cyan-400 bg-cyan-50/50 dark:border-cyan-700 dark:bg-cyan-950/20',
    message: 'bg-cyan-500/10 dark:bg-cyan-500/15',
  },
] as const

export function chatTopicColorStyle(colorIndex: number) {
  return CHAT_TOPIC_COLOR_STYLES[normalizeColorIndex(colorIndex)]!
}

export function isMessageInChatTopicHighlight(
  highlight: ChatTopicHighlight,
  message: { id: number; timestamp: number },
  exactMessageIds: ReadonlySet<number> = new Set(highlight.messageIds)
): boolean {
  if (highlight.assignmentMode === 'exact') return exactMessageIds.has(message.id)
  return highlight.timeRanges.some((range) => {
    const startTs = Math.floor(range.startTs / 60) * 60
    const endTs = Math.floor(range.endTs / 60) * 60 + 59
    return message.timestamp >= startTs && message.timestamp <= endTs
  })
}

function normalizeColorIndex(colorIndex: number): number {
  const length = CHAT_TOPIC_COLOR_STYLES.length
  return ((Math.trunc(colorIndex) % length) + length) % length
}
