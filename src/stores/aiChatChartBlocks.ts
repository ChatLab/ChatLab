import type { ChartPayload } from '@openchatlab/core'

export type ChartContentBlock = { type: 'chart'; chart: ChartPayload }
export type RenderOnlyToolErrorBlock = {
  type: 'error'
  error: { name: string | null; message: string; stack: string | null }
}

export function isRenderOnlyTool(toolName?: string): boolean {
  return toolName === 'render_chart'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isChartPayload(value: unknown): value is ChartPayload {
  return isRecord(value) && value.version === 1 && isRecord(value.spec) && isRecord(value.dataset)
}

export function extractChartPayloads(toolResult: unknown): ChartPayload[] {
  if (!isRecord(toolResult)) return []
  const details = isRecord(toolResult.details) ? toolResult.details : toolResult
  const charts: ChartPayload[] = []

  if (isChartPayload(details.chart)) charts.push(details.chart)
  if (Array.isArray(details.charts)) {
    for (const chart of details.charts) {
      if (isChartPayload(chart)) charts.push(chart)
    }
  }

  return charts
}

export function toPersistedChartPayload(chart: ChartPayload): ChartPayload {
  return {
    ...chart,
    dataset: {
      ...chart.dataset,
      rows: [],
    },
  }
}

export function toChartContentBlocks(charts: ChartPayload[]): ChartContentBlock[] {
  return charts.map((chart) => ({ type: 'chart', chart: toPersistedChartPayload(chart) }))
}

export function shouldHideRecoverableChartError(blocks: readonly unknown[], index: number): boolean {
  const block = blocks[index]
  if (!isRecord(block) || block.type !== 'error' || !isRecord(block.error)) return false
  if (block.error.name !== 'ChartRenderError') return false

  return blocks.slice(index + 1).some((nextBlock) => isRecord(nextBlock) && nextBlock.type === 'chart')
}

function extractToolResultText(toolResult: unknown): string | null {
  if (!isRecord(toolResult)) return null
  if (typeof toolResult.error === 'string') return toolResult.error
  if (isRecord(toolResult.error) && typeof toolResult.error.message === 'string') return toolResult.error.message
  if (Array.isArray(toolResult.content)) {
    return toolResult.content
      .map((part) => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
      .join('\n')
      .trim()
  }
  return null
}

export function toRenderOnlyToolErrorBlock(
  toolName: string | undefined,
  toolResult: unknown
): RenderOnlyToolErrorBlock | null {
  if (!isRenderOnlyTool(toolName)) return null
  if (extractChartPayloads(toolResult).length > 0) return null

  const text = extractToolResultText(toolResult)
  if (!text) return null

  const match = /^Error:\s*(.+)$/is.exec(text)
  const message = match?.[1]?.trim()
  if (!message) return null
  if (/^Call get_schema before render_chart\b/i.test(message)) return null

  return {
    type: 'error',
    error: {
      name: 'ChartRenderError',
      message,
      stack: null,
    },
  }
}
