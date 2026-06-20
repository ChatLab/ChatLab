export type ProcessSegment<T> = { type: 'process'; blocks: T[] } | { type: 'visible'; block: T }

export interface ProcessSegmentOptions<T> {
  isFoldableProcessBlock: (block: T) => boolean
  isTextBlock: (block: T) => boolean
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

export function buildProcessSegments<T>(blocks: T[], options: ProcessSegmentOptions<T>): ProcessSegment<T>[] {
  const segments: ProcessSegment<T>[] = []

  blocks.forEach((block, index) => {
    const isProcess =
      options.isFoldableProcessBlock(block) ||
      (options.isTextBlock(block) && hasLaterFoldableProcessBlock(blocks, index, options.isFoldableProcessBlock))

    if (!isProcess) {
      segments.push({ type: 'visible', block })
      return
    }

    const lastSegment = segments[segments.length - 1]
    if (lastSegment?.type === 'process') {
      lastSegment.blocks.push(block)
    } else {
      segments.push({ type: 'process', blocks: [block] })
    }
  })

  return segments
}

export function getVisibleSegmentBlocks<T>(segments: ProcessSegment<T>[]): T[] {
  return segments.flatMap((segment) => (segment.type === 'visible' ? [segment.block] : []))
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

export function getProcessSegmentStatusLabel<T>(
  segment: ProcessSegment<T>,
  options: ProcessSegmentStatusLabelOptions<T>
): string {
  if (options.isProcessing) return options.labels.processing

  const durationMs = getProcessSegmentDurationMs(segment, options.getBlockDurationMs)
  const duration = durationMs > 0 ? ` ${formatProcessDuration(durationMs, options.locale)}` : ''
  return `${options.labels.processed}${duration}`
}
