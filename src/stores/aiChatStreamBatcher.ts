export type AIStreamTextDelta =
  | { type: 'content'; content: string }
  | { type: 'think'; content: string; thinkTag?: string }

export interface StreamTextTarget {
  isStreaming?: boolean
  content: string
  contentBlocks?: Array<{ type: string; text?: string; tag?: string }>
}

export function applyQueuedStreamTextDeltas(
  message: StreamTextTarget,
  deltas: AIStreamTextDelta[]
): { content: string; contentBlocks: NonNullable<StreamTextTarget['contentBlocks']> } | null {
  if (!message.isStreaming) return null

  const blocks = message.contentBlocks ? [...message.contentBlocks] : []
  let content = message.content
  let changed = false

  for (const delta of deltas) {
    const lastBlock = blocks[blocks.length - 1]
    if (delta.type === 'content') {
      if (delta.content.trim().length === 0 && lastBlock?.type !== 'text') continue
      if (lastBlock?.type === 'text') lastBlock.text = (lastBlock.text || '') + delta.content
      else blocks.push({ type: 'text', text: delta.content })
      content += delta.content
      changed = true
      continue
    }

    const thinkTag = delta.thinkTag || 'think'
    if (lastBlock?.type === 'think' && lastBlock.tag === thinkTag) {
      lastBlock.text = (lastBlock.text || '') + delta.content
      changed = true
    } else if (delta.content.trim().length > 0) {
      blocks.push({ type: 'think', tag: thinkTag, text: delta.content })
      changed = true
    }
  }

  if (!changed) return { content: message.content, contentBlocks: message.contentBlocks || [] }
  return { content, contentBlocks: blocks }
}

interface FrameScheduler {
  request: (callback: () => void) => number
  cancel: (handle: number) => void
}

function createDefaultFrameScheduler(): FrameScheduler {
  if (typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function') {
    return {
      request: (callback) => requestAnimationFrame(callback),
      cancel: (handle) => cancelAnimationFrame(handle),
    }
  }

  return {
    request: (callback) => setTimeout(callback, 16) as unknown as number,
    cancel: (handle) => clearTimeout(handle),
  }
}

export function createAIStreamTextBatcher(
  apply: (deltas: AIStreamTextDelta[]) => void,
  scheduler: FrameScheduler = createDefaultFrameScheduler()
): {
  push: (delta: AIStreamTextDelta) => void
  flush: () => void
  cancel: () => void
} {
  let pendingFrame: number | null = null
  let pendingDeltas: AIStreamTextDelta[] = []

  function flush() {
    if (pendingFrame !== null) {
      scheduler.cancel(pendingFrame)
      pendingFrame = null
    }
    if (pendingDeltas.length === 0) return

    const deltas = pendingDeltas
    pendingDeltas = []
    apply(deltas)
  }

  function push(delta: AIStreamTextDelta) {
    const previous = pendingDeltas[pendingDeltas.length - 1]
    if (previous?.type === 'content' && delta.type === 'content') {
      previous.content += delta.content
    } else if (previous?.type === 'think' && delta.type === 'think' && previous.thinkTag === delta.thinkTag) {
      previous.content += delta.content
    } else {
      pendingDeltas.push({ ...delta })
    }

    if (pendingFrame === null) {
      pendingFrame = scheduler.request(() => {
        pendingFrame = null
        flush()
      })
    }
  }

  function cancel() {
    if (pendingFrame !== null) {
      scheduler.cancel(pendingFrame)
      pendingFrame = null
    }
    pendingDeltas = []
  }

  return { push, flush, cancel }
}
