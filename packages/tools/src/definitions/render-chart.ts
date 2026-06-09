/**
 * Dynamic chart rendering tool.
 *
 * The model provides read-only SQL plus a ChartSpec. ChatLab executes and
 * validates the result before producing a chart payload for the chat UI.
 */

import { buildChartPayload } from '@openchatlab/core'
import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'

const DEFAULT_MAX_ROWS = 1000
const DEFAULT_PREVIEW_ROWS = 20
const RE_SECONDS_TIMESTAMP_DIVIDED_AS_MILLISECONDS = /\b(?:\w+\.)?ts\s*\/\s*1000\b/i

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      description:
        'Pre-fetched data rows to render directly, skipping SQL execution. Pass the data array from a high-level tool result (e.g. the `data` field from get_time_stats, or member activity rows). Prefer this over sql when data is already available. Mutually exclusive with sql.',
      items: { type: 'object' },
    },
    sql: {
      type: 'string',
      description:
        'Read-only SELECT or WITH SELECT SQL used to produce chart rows. Use only when pre-fetched data is unavailable or custom aggregation is required.',
    },
    params: {
      type: 'object',
      description: 'Named SQL parameters. Only used when sql is provided.',
      additionalProperties: true,
      default: {},
    },
    chartSpec: {
      type: 'object',
      description:
        'ChartSpec v1. Required fields: version, type, title, encoding. Supported types: bar, line, pie, heatmap.',
      additionalProperties: true,
    },
    maxRows: {
      type: 'number',
      description: 'Maximum rows to fetch before chart normalization.',
      default: DEFAULT_MAX_ROWS,
      minimum: 1,
      maximum: 5000,
    },
  },
  required: ['chartSpec'],
}

function normalizeSql(sql: unknown, maxRows: number): string {
  if (typeof sql !== 'string' || sql.trim().length === 0) {
    throw new Error('sql must be a non-empty string')
  }

  const trimmed = sql.trim().replace(/;+\s*$/, '')
  if (trimmed.includes(';')) {
    throw new Error('Only a single read-only SQL statement is allowed')
  }

  const statementStart = trimmed.replace(/^(\s|--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/)*/, '')
  if (!/^(SELECT|WITH)\b/i.test(statementStart)) {
    throw new Error('render_chart only accepts SELECT or WITH SELECT SQL')
  }

  if (RE_SECONDS_TIMESTAMP_DIVIDED_AS_MILLISECONDS.test(trimmed)) {
    throw new Error('message.ts is already a Unix timestamp in seconds; do not divide ts by 1000')
  }

  return `SELECT * FROM (\n${trimmed}\n) AS chart_query LIMIT ${maxRows + 1}`
}

function normalizeParams(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as Record<string, unknown>
}

function normalizeRows(raw: unknown, maxRows: number): { rows: Record<string, unknown>[]; truncated: boolean } {
  if (!Array.isArray(raw)) throw new Error('rows must be an array')
  const items = raw.filter(
    (item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item)
  )
  const truncated = items.length > maxRows
  return { rows: truncated ? items.slice(0, maxRows) : items, truncated }
}

function normalizeMaxRows(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : DEFAULT_MAX_ROWS
  if (!Number.isFinite(value)) return DEFAULT_MAX_ROWS
  return Math.min(5000, Math.max(1, Math.floor(value)))
}

function summarizeChart(type: string, title: string, rowCount: number, truncated: boolean, locale?: string): string {
  if (locale?.startsWith('zh')) {
    return `已生成图表「${title}」（${type}，${rowCount} 行数据${truncated ? '，已截断' : ''}）。`
  }
  return `Generated chart "${title}" (${type}, ${rowCount} rows${truncated ? ', truncated' : ''}).`
}

function summarizeChartForModel(
  type: string,
  title: string,
  rows: Record<string, unknown>[],
  truncated: boolean,
  locale?: string
): string {
  const summary = summarizeChart(type, title, rows.length, truncated, locale)
  const previewRows = rows.slice(0, DEFAULT_PREVIEW_ROWS)
  if (previewRows.length === 0) return summary

  const preview = JSON.stringify(previewRows)
  if (locale?.startsWith('zh')) {
    return `${summary}\n数据预览（前 ${previewRows.length} 行，用于分析峰值、低谷和差异）：${preview}`
  }
  return `${summary}\nData preview (first ${previewRows.length} rows; use this to identify peaks, lows, and differences): ${preview}`
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  if (!context.dataProvider) throw new Error('render_chart requires a data provider')

  const hasSql = typeof params.sql === 'string' && params.sql.trim().length > 0
  const hasRows = Array.isArray(params.rows)
  if (!hasSql && !hasRows) throw new Error('render_chart requires either sql or rows')

  const maxRows = normalizeMaxRows(params.maxRows)
  let rows: Record<string, unknown>[]
  let truncated: boolean

  if (hasRows) {
    const normalized = normalizeRows(params.rows, maxRows)
    rows = normalized.rows
    truncated = normalized.truncated
  } else {
    const sql = normalizeSql(params.sql, maxRows)
    const sqlParams = normalizeParams(params.params)
    const fetchedRows = await context.dataProvider.executeParameterizedSql<Record<string, unknown>>(sql, sqlParams)
    truncated = fetchedRows.length > maxRows
    rows = truncated ? fetchedRows.slice(0, maxRows) : fetchedRows
  }

  const chart = buildChartPayload(rows, params.chartSpec, { truncated })

  return {
    content: summarizeChartForModel(chart.spec.type, chart.spec.title, rows, truncated, context.locale),
    data: {
      rowCount: rows.length,
      truncated,
      chartType: chart.spec.type,
      title: chart.spec.title,
    },
    chart,
  }
}

export const renderChartTool: ToolDefinition = {
  name: 'render_chart',
  description:
    "Generate a native ChatLab chart from ChartSpec v1. Provide either `rows` (pre-fetched data array from a tool result such as get_time_stats or member_stats) or `sql` (read-only SELECT). Prefer `rows` when data is already available — pass the tool's data array directly. Use `sql` only for custom aggregations not covered by existing tools. Never output HTML, JavaScript, SVG, ECharts options, or rendering code.",
  inputSchema,
  handler,
  category: 'analysis',
}
