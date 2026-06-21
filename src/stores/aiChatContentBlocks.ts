import type { ContentBlock } from './aiChat'

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
