export type ChartType = 'bar' | 'line' | 'pie' | 'heatmap'

export type ChartFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'datetime' | 'category'

export interface ChartField {
  name: string
  type: ChartFieldType
  label?: string
  unit?: string
}

export interface ChartEncoding {
  x?: string
  y?: string
  value?: string
  label?: string
  series?: string
  color?: string
}

export interface ChartSpec {
  version: 1
  type: ChartType
  title: string
  subtitle?: string
  description?: string
  encoding: ChartEncoding
  fields?: ChartField[]
  unit?: string
  filters?: {
    timeRange?: { startTs?: number; endTs?: number; label?: string }
    members?: Array<{ id?: number; name: string }>
    keywords?: string[]
    messageTypes?: number[]
    custom?: Record<string, unknown>
  }
  display?: {
    horizontal?: boolean
    stacked?: boolean
    showLegend?: boolean
    showDataZoom?: boolean
    height?: number
  }
}

export interface ChartDataset {
  columns: ChartField[]
  rows: Record<string, unknown>[]
}

export interface BarChartRenderData {
  labels: string[]
  values: number[]
}

export interface LineChartRenderData {
  labels: string[]
  values: number[]
  series?: Array<{ name: string; values: number[] }>
}

export interface PieChartRenderData {
  labels: string[]
  values: number[]
}

export interface HeatmapChartRenderData {
  xLabels: string[]
  yLabels: string[]
  data: Array<[number, number, number]>
}

export type ChartRenderData = BarChartRenderData | LineChartRenderData | PieChartRenderData | HeatmapChartRenderData

export interface ChartPayload {
  version: 1
  spec: ChartSpec
  dataset: ChartDataset
  data: ChartRenderData
  rowCount: number
  truncated?: boolean
}

export class ChartValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChartValidationError'
  }
}

const CHART_TYPES = new Set<ChartType>(['bar', 'line', 'pie', 'heatmap'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asFieldName(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ChartValidationError(`${label} must be a non-empty field name`)
  }
  return value
}

function assertFieldExists(rows: Record<string, unknown>[], field: string): void {
  if (rows.length === 0) return
  if (!Object.prototype.hasOwnProperty.call(rows[0], field)) {
    throw new ChartValidationError(`Field "${field}" does not exist in SQL result`)
  }
}

function toLabel(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)'
  return String(value)
}

function toNumber(value: unknown, field: string): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) {
    throw new ChartValidationError(`Field "${field}" contains non-numeric value "${String(value)}"`)
  }
  return num
}

function inferFieldType(values: unknown[]): ChartFieldType {
  const present = values.filter((v) => v !== null && v !== undefined)
  if (present.length === 0) return 'string'
  if (present.every((v) => typeof v === 'number' && Number.isInteger(v))) return 'integer'
  if (
    present.every(
      (v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)))
    )
  ) {
    return 'number'
  }
  if (present.every((v) => typeof v === 'boolean')) return 'boolean'
  return 'category'
}

export function normalizeChartSpec(raw: unknown): ChartSpec {
  if (!isRecord(raw)) throw new ChartValidationError('chartSpec must be an object')
  if (raw.version !== 1) throw new ChartValidationError('chartSpec.version must be 1')
  if (typeof raw.type !== 'string' || !CHART_TYPES.has(raw.type as ChartType)) {
    throw new ChartValidationError('chartSpec.type must be one of: bar, line, pie, heatmap')
  }
  if (typeof raw.title !== 'string' || raw.title.trim().length === 0) {
    throw new ChartValidationError('chartSpec.title must be a non-empty string')
  }
  if (!isRecord(raw.encoding)) throw new ChartValidationError('chartSpec.encoding must be an object')

  const spec = raw as unknown as ChartSpec
  switch (spec.type) {
    case 'bar':
    case 'line':
      asFieldName(spec.encoding.x, 'encoding.x')
      asFieldName(spec.encoding.y, 'encoding.y')
      break
    case 'pie':
      asFieldName(spec.encoding.label, 'encoding.label')
      asFieldName(spec.encoding.value, 'encoding.value')
      break
    case 'heatmap':
      asFieldName(spec.encoding.x, 'encoding.x')
      asFieldName(spec.encoding.y, 'encoding.y')
      asFieldName(spec.encoding.value, 'encoding.value')
      break
  }

  return {
    ...spec,
    title: spec.title.trim(),
  }
}

export function inferChartDataset(rows: Record<string, unknown>[], declaredFields?: ChartField[]): ChartDataset {
  const declared = new Map((declaredFields ?? []).map((field) => [field.name, field]))
  const columnNames = rows.length > 0 ? Object.keys(rows[0]) : [...declared.keys()]
  const columns = columnNames.map((name) => {
    const declaredField = declared.get(name)
    if (declaredField) return declaredField
    return {
      name,
      type: inferFieldType(rows.map((row) => row[name])),
    }
  })

  return { columns, rows }
}

function aggregateByLabel(
  rows: Record<string, unknown>[],
  labelField: string,
  valueField: string
): {
  labels: string[]
  values: number[]
} {
  const labels: string[] = []
  const indexByLabel = new Map<string, number>()
  const values: number[] = []

  for (const row of rows) {
    const label = toLabel(row[labelField])
    let index = indexByLabel.get(label)
    if (index === undefined) {
      index = labels.length
      indexByLabel.set(label, index)
      labels.push(label)
      values.push(0)
    }
    values[index] += toNumber(row[valueField], valueField)
  }

  return { labels, values }
}

function buildLineData(rows: Record<string, unknown>[], spec: ChartSpec): LineChartRenderData {
  const xField = spec.encoding.x!
  const yField = spec.encoding.y!
  const seriesField = spec.encoding.series

  if (!seriesField) return aggregateByLabel(rows, xField, yField)

  assertFieldExists(rows, seriesField)
  const labels: string[] = []
  const labelIndex = new Map<string, number>()
  const seriesNames: string[] = []
  const seriesIndex = new Map<string, number>()
  const matrix: number[][] = []

  for (const row of rows) {
    const label = toLabel(row[xField])
    const seriesName = toLabel(row[seriesField])
    let xIndex = labelIndex.get(label)
    if (xIndex === undefined) {
      xIndex = labels.length
      labelIndex.set(label, xIndex)
      labels.push(label)
      for (const values of matrix) values.push(0)
    }

    let sIndex = seriesIndex.get(seriesName)
    if (sIndex === undefined) {
      sIndex = seriesNames.length
      seriesIndex.set(seriesName, sIndex)
      seriesNames.push(seriesName)
      matrix.push(Array(labels.length).fill(0))
    }

    matrix[sIndex][xIndex] += toNumber(row[yField], yField)
  }

  const series = seriesNames.map((name, index) => ({ name, values: matrix[index] }))
  return {
    labels,
    values: series[0]?.values ?? [],
    series,
  }
}

function buildHeatmapData(rows: Record<string, unknown>[], spec: ChartSpec): HeatmapChartRenderData {
  const xField = spec.encoding.x!
  const yField = spec.encoding.y!
  const valueField = spec.encoding.value!
  const xLabels: string[] = []
  const yLabels: string[] = []
  const xIndex = new Map<string, number>()
  const yIndex = new Map<string, number>()
  const values = new Map<string, number>()

  for (const row of rows) {
    const xLabel = toLabel(row[xField])
    const yLabel = toLabel(row[yField])
    let xi = xIndex.get(xLabel)
    if (xi === undefined) {
      xi = xLabels.length
      xIndex.set(xLabel, xi)
      xLabels.push(xLabel)
    }
    let yi = yIndex.get(yLabel)
    if (yi === undefined) {
      yi = yLabels.length
      yIndex.set(yLabel, yi)
      yLabels.push(yLabel)
    }
    const key = `${xi}:${yi}`
    values.set(key, (values.get(key) ?? 0) + toNumber(row[valueField], valueField))
  }

  const data: Array<[number, number, number]> = []
  for (const [key, value] of values.entries()) {
    const [x, y] = key.split(':').map(Number)
    data.push([x, y, value])
  }

  return { xLabels, yLabels, data }
}

export function buildChartPayload(
  rows: Record<string, unknown>[],
  rawSpec: unknown,
  options?: { truncated?: boolean }
): ChartPayload {
  const spec = normalizeChartSpec(rawSpec)
  const dataset = inferChartDataset(rows, spec.fields)

  const requiredFields = new Set<string>()
  for (const field of Object.values(spec.encoding)) {
    if (typeof field === 'string' && field) requiredFields.add(field)
  }
  for (const field of requiredFields) assertFieldExists(rows, field)

  let data: ChartRenderData
  switch (spec.type) {
    case 'bar':
      data = aggregateByLabel(rows, spec.encoding.x!, spec.encoding.y!)
      break
    case 'line':
      data = buildLineData(rows, spec)
      break
    case 'pie':
      data = aggregateByLabel(rows, spec.encoding.label!, spec.encoding.value!)
      break
    case 'heatmap':
      data = buildHeatmapData(rows, spec)
      break
  }

  return {
    version: 1,
    spec,
    dataset,
    data,
    rowCount: rows.length,
    truncated: options?.truncated,
  }
}
