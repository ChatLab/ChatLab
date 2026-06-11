import type { ChartPayload } from '@openchatlab/core'

export type ChartContentBlock = { type: 'chart'; chart: ChartPayload }
export type RenderOnlyToolPendingBlock = {
  type: 'tool'
  tool: {
    name: string
    displayName: string
    status: 'running' | 'done' | 'error'
    params?: Record<string, unknown>
    toolCallId?: string
    transient: true
  }
}
export type RenderOnlyToolErrorBlock = {
  type: 'error'
  error: { name: string | null; message: string; stack: string | null }
}

type BlockWithTool = {
  type?: unknown
  tool?: {
    name?: unknown
    status?: unknown
    toolCallId?: unknown
    transient?: unknown
  }
}

type BlockWithChart = {
  type?: unknown
  chart?: ChartPayload
}

export function isRenderOnlyTool(toolName?: string): boolean {
  return toolName === 'render_chart'
}

export function createRenderOnlyToolPendingBlock(
  toolName: string | undefined,
  params?: Record<string, unknown>,
  toolCallId?: string
): RenderOnlyToolPendingBlock | null {
  if (!toolName || !isRenderOnlyTool(toolName)) return null
  const name = toolName

  return {
    type: 'tool',
    tool: {
      name,
      displayName: name,
      status: 'running',
      params,
      toolCallId,
      transient: true,
    },
  }
}

function isMatchingPendingRenderOnlyToolBlock(
  block: unknown,
  toolName: string | undefined,
  toolCallId?: string
): block is RenderOnlyToolPendingBlock {
  if (!isRecord(block)) return false
  const candidate = block as BlockWithTool
  if (candidate.type !== 'tool' || !candidate.tool) return false
  if (candidate.tool.transient !== true) return false
  if (candidate.tool.name !== toolName) return false
  if (toolCallId && candidate.tool.toolCallId !== toolCallId) return false
  return isRenderOnlyTool(String(candidate.tool.name))
}

export function removeRenderOnlyToolPendingBlock<T>(
  blocks: readonly T[],
  toolName: string | undefined,
  toolCallId?: string
): T[] {
  let removed = false
  const next = [...blocks]
  for (let index = next.length - 1; index >= 0; index--) {
    if (isMatchingPendingRenderOnlyToolBlock(next[index], toolName, toolCallId)) {
      next.splice(index, 1)
      removed = true
      break
    }
  }
  return removed ? next : [...blocks]
}

export function completeRenderOnlyToolPendingBlock<T>(
  blocks: readonly T[],
  toolName: string | undefined,
  toolCallId: string | undefined,
  status: 'done' | 'error'
): T[] {
  const next = blocks.map((block) => {
    if (!isMatchingPendingRenderOnlyToolBlock(block, toolName, toolCallId)) return block
    return {
      ...block,
      tool: {
        ...block.tool,
        status,
      },
    }
  })
  return next as T[]
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

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function chartSignature(chart: ChartPayload): string {
  const persisted = toPersistedChartPayload(chart)
  return stableStringify({
    spec: persisted.spec,
    columns: persisted.dataset.columns,
    data: persisted.data,
    rowCount: persisted.rowCount,
    truncated: persisted.truncated,
  })
}

function hasDuplicateChart(blocks: readonly unknown[], chart: ChartPayload): boolean {
  const signature = chartSignature(chart)
  return blocks.some((block) => {
    if (!isRecord(block)) return false
    const candidate = block as BlockWithChart
    return candidate.type === 'chart' && candidate.chart ? chartSignature(candidate.chart) === signature : false
  })
}

export function replaceRenderOnlyToolPendingBlockWithCharts<T>(
  blocks: readonly T[],
  toolName: string | undefined,
  toolCallId: string | undefined,
  charts: ChartPayload[]
): Array<T | ChartContentBlock> {
  const withoutPending = removeRenderOnlyToolPendingBlock(blocks, toolName, toolCallId)
  const uniqueCharts = charts.filter((chart) => !hasDuplicateChart(withoutPending, chart))
  return [...withoutPending, ...toChartContentBlocks(uniqueCharts)]
}

export function shouldHideRecoverableChartError(
  blocks: readonly unknown[],
  index: number,
  options?: { isStreaming?: boolean }
): boolean {
  const block = blocks[index]
  if (!isRecord(block) || block.type !== 'error' || !isRecord(block.error)) return false
  if (block.error.name !== 'ChartRenderError') return false
  if (options?.isStreaming) return true

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
