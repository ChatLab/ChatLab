import type { ContentBlock } from './aiChat'

export function getPersistedProcessDurationMs(blocks: ContentBlock[] | undefined): number | undefined {
  if (!blocks) return undefined
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block.type === 'text' && block.processDurationMs !== undefined) {
      return block.processDurationMs
    }
  }
  return undefined
}

export function persistProcessDurationMs(
  blocks: ContentBlock[] | undefined,
  processDurationMs: number
): ContentBlock[] | undefined {
  if (!blocks) return undefined
  const textIndex = blocks.findLastIndex((block) => block.type === 'text')
  if (textIndex < 0) return blocks

  return blocks.map((block, index) =>
    index === textIndex && block.type === 'text' ? { ...block, processDurationMs } : block
  )
}

export function toSerializableContentBlocks(blocks: ContentBlock[] | undefined) {
  if (!blocks) return undefined
  const cloned = JSON.parse(JSON.stringify(blocks))
  for (const block of cloned) {
    if (block.type === 'tool') {
      delete block.tool.displayResult
    }
  }
  return cloned
}
