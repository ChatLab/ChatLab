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
    sql: {
      type: 'string',
      description: 'Read-only SELECT or WITH SELECT SQL used to produce chart rows.',
    },
    params: {
      type: 'object',
      description: 'Named SQL parameters. Use an empty object when no parameters are needed.',
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
  required: ['sql', 'chartSpec'],
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

  const maxRows = normalizeMaxRows(params.maxRows)
  const sql = normalizeSql(params.sql, maxRows)
  const sqlParams = normalizeParams(params.params)

  const fetchedRows = await context.dataProvider.executeParameterizedSql<Record<string, unknown>>(sql, sqlParams)
  const truncated = fetchedRows.length > maxRows
  const rows = truncated ? fetchedRows.slice(0, maxRows) : fetchedRows
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
    'Generate a native ChatLab chart from read-only SQL plus ChartSpec v1. Use this for flexible bar, line, pie, and heatmap charts. Never output HTML, JavaScript, SVG, ECharts options, or rendering code.',
  inputSchema,
  handler,
  category: 'analysis',
}
