export type ProcessSegment<T> = { type: 'process'; blocks: T[] } | { type: 'visible'; block: T }

export interface ProcessSegmentOptions<T> {
  isFoldableProcessBlock: (block: T) => boolean
  isTextBlock: (block: T) => boolean
  mode: 'timeline' | 'completed'
}

export interface ProcessSegmentStatusLabelOptions<T> {
  getBlockDurationMs: (block: T) => number | undefined
  isProcessing: boolean
  labels: {
    processed: string
    processing: string
  }
  locale: string
}

interface ProcessThoughtCandidate {
  type: string
  tag?: string
  text?: string
}

function hasLaterFoldableProcessBlock<T>(
  blocks: T[],
  startIndex: number,
  isFoldableProcessBlock: (block: T) => boolean
): boolean {
  for (let index = startIndex + 1; index < blocks.length; index += 1) {
    if (isFoldableProcessBlock(blocks[index])) return true
  }
  return false
}

function buildTimelineSegments<T>(blocks: T[], isFoldableProcessBlock: (block: T) => boolean): ProcessSegment<T>[] {
  const segments: ProcessSegment<T>[] = []
  let processBlocks: T[] = []

  const flushProcess = () => {
    if (processBlocks.length === 0) return
    segments.push({ type: 'process', blocks: processBlocks })
    processBlocks = []
  }

  for (const block of blocks) {
    if (isFoldableProcessBlock(block)) {
      processBlocks.push(block)
      continue
    }

    flushProcess()
    segments.push({ type: 'visible', block })
  }

  flushProcess()
  return segments
}

function buildCompletedSegments<T>(
  blocks: T[],
  isFoldableProcessBlock: (block: T) => boolean,
  isTextBlock: (block: T) => boolean
): ProcessSegment<T>[] {
  const isProcessBlock = blocks.map(
    (block, index) =>
      isFoldableProcessBlock(block) ||
      (isTextBlock(block) && hasLaterFoldableProcessBlock(blocks, index, isFoldableProcessBlock))
  )
  const processBlocks = blocks.filter((_block, index) => isProcessBlock[index])
  const firstProcessIndex = isProcessBlock.findIndex(Boolean)
  const segments: ProcessSegment<T>[] = []

  blocks.forEach((block, index) => {
    if (index === firstProcessIndex) {
      segments.push({ type: 'process', blocks: processBlocks })
      return
    }

    if (isProcessBlock[index]) return
    segments.push({ type: 'visible', block })
  })

  return segments
}

export function buildProcessSegments<T>(blocks: T[], options: ProcessSegmentOptions<T>): ProcessSegment<T>[] {
  if (options.mode === 'timeline') {
    return buildTimelineSegments(blocks, options.isFoldableProcessBlock)
  }
  return buildCompletedSegments(blocks, options.isFoldableProcessBlock, options.isTextBlock)
}

export function isActiveProcessSegment<T>(
  segments: ProcessSegment<T>[],
  segmentIndex: number,
  isStreaming: boolean
): boolean {
  return isStreaming && segmentIndex === segments.length - 1 && segments[segmentIndex]?.type === 'process'
}

export function getVisibleSegmentBlocks<T>(segments: ProcessSegment<T>[]): T[] {
  return segments.flatMap((segment) => (segment.type === 'visible' ? [segment.block] : []))
}

export function findRepresentativeProcessThought<T extends ProcessThoughtCandidate>(
  blocks: readonly T[]
): Extract<T, { type: 'think' }> | undefined {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block.type === 'think' && block.tag?.toLowerCase() !== 'plan_validation' && Boolean(block.text?.trim())) {
      return block as Extract<T, { type: 'think' }>
    }
  }
  return undefined
}

export function formatProcessDuration(durationMs: number, locale: string): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  if (locale.startsWith('zh') || locale.startsWith('ja')) {
    if (totalSeconds < 60) return `${totalSeconds}秒`
    if (totalSeconds < 3600) {
      const minutes = Math.floor(totalSeconds / 60)
      const seconds = totalSeconds % 60
      return `${minutes}分${seconds.toString().padStart(2, '0')}秒`
    }
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return `${hours}时${minutes.toString().padStart(2, '0')}分${seconds.toString().padStart(2, '0')}秒`
  }

  if (totalSeconds < 60) return `${totalSeconds}s`
  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
  }
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${hours}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`
}

export function getProcessSegmentDurationMs<T>(
  segment: ProcessSegment<T>,
  getBlockDurationMs: (block: T) => number | undefined
): number {
  if (segment.type !== 'process') return 0
  return segment.blocks.reduce((total, block) => total + (getBlockDurationMs(block) ?? 0), 0)
}

export function resolveProcessElapsedMs(input: {
  isStreaming: boolean
  liveElapsedMs: number
  settledElapsedMs: number
  recordedElapsedMs: number
}): number {
  if (input.isStreaming) return input.liveElapsedMs
  return input.settledElapsedMs || input.recordedElapsedMs
}

export function getProcessSegmentStatusLabel<T>(
  segment: ProcessSegment<T>,
  options: ProcessSegmentStatusLabelOptions<T>
): string {
  if (options.isProcessing) return options.labels.processing

  const durationMs = getProcessSegmentDurationMs(segment, options.getBlockDurationMs)
  const duration = durationMs > 0 ? ` ${formatProcessDuration(durationMs, options.locale)}` : ''
  return `${options.labels.processed}${duration}`
}

export type ProcessHeaderActivity =
  | { type: 'tool'; name: string; progressPhase?: string }
  | { type: 'think' }
  | { type: 'skill'; name: string }
  | { type: 'plan' }
  | { type: 'generic' }

export function resolveProcessHeaderActivity(input: {
  isActive: boolean
  activeToolName?: string
  activeToolProgressPhase?: string
  lastFoldable?: {
    kind: 'tool' | 'think' | 'skill' | 'plan' | 'plan_draft' | 'error'
    name?: string
  }
}): ProcessHeaderActivity {
  if (input.isActive && input.activeToolName) {
    return {
      type: 'tool',
      name: input.activeToolName,
      progressPhase: input.activeToolProgressPhase,
    }
  }

  if (input.isActive && input.lastFoldable) {
    if (input.lastFoldable.kind === 'think') return { type: 'think' }
    if (input.lastFoldable.kind === 'skill' && input.lastFoldable.name) {
      return { type: 'skill', name: input.lastFoldable.name }
    }
    if (input.lastFoldable.kind === 'plan' || input.lastFoldable.kind === 'plan_draft') {
      return { type: 'plan' }
    }
    if (input.lastFoldable.kind === 'tool' && input.lastFoldable.name) {
      return { type: 'tool', name: input.lastFoldable.name }
    }
  }

  return { type: 'generic' }
}
