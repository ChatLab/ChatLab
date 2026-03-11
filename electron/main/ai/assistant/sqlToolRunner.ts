/**
 * 声明式 SQL 工具运行器
 *
 * 将 CustomSqlToolDef JSON 配置转换为可执行的 AgentTool，
 * 通过 pluginQuery 执行参数化 SQL 并格式化结果。
 */

import { Type, type TObject, type TProperties } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../tools/types'
import type { CustomSqlToolDef, JsonSchemaObject } from './types'
import * as workerManager from '../../worker/workerManager'
import { t as i18nT } from '../../i18n'

/**
 * 将简化 JSON Schema 对象转换为 TypeBox TObject
 *
 * 仅覆盖 SQL 工具参数定义的常见类型（string / number / integer / boolean）。
 */
export function jsonSchemaToTypeBox(schema: JsonSchemaObject): TObject<TProperties> {
  const props: TProperties = {}

  for (const [key, prop] of Object.entries(schema.properties)) {
    const isRequired = schema.required?.includes(key) ?? false
    const opts: Record<string, unknown> = {}
    if (prop.description) opts.description = prop.description
    if (prop.default !== undefined) opts.default = prop.default

    let typeBoxProp
    switch (prop.type) {
      case 'string':
        typeBoxProp = Type.String(opts)
        break
      case 'number':
        typeBoxProp = Type.Number(opts)
        break
      case 'integer':
        typeBoxProp = Type.Integer(opts)
        break
      case 'boolean':
        typeBoxProp = Type.Boolean(opts)
        break
      default:
        typeBoxProp = Type.String(opts)
    }

    props[key] = isRequired ? typeBoxProp : Type.Optional(typeBoxProp)
  }

  return Type.Object(props)
}

function formatRow(template: string, row: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, col) => {
    const val = row[col]
    return val !== null && val !== undefined ? String(val) : ''
  })
}

/**
 * Resolve an i18n template string for a SQL tool, falling back to the definition's original value.
 */
function resolveTemplate(toolName: string, key: string, fallback: string): string {
  const i18nKey = `ai.tools.${toolName}.${key}`
  const translated = i18nT(i18nKey)
  return translated !== i18nKey ? translated : fallback
}

/**
 * 从 CustomSqlToolDef 创建可执行的 AgentTool
 */
export function createSqlTool(def: CustomSqlToolDef, context: ToolContext): AgentTool<any> {
  const schema = jsonSchemaToTypeBox(def.parameters)

  return {
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: schema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const rows = await workerManager.pluginQuery(context.sessionId, def.execution.query, params)

      const fallback = resolveTemplate(def.name, 'fallback', def.execution.fallback)

      if (!rows || rows.length === 0) {
        return { content: [{ type: 'text' as const, text: fallback }] }
      }

      const rowTemplate = resolveTemplate(def.name, 'rowTemplate', def.execution.rowTemplate)
      const summaryTemplate = def.execution.summaryTemplate
        ? resolveTemplate(def.name, 'summaryTemplate', def.execution.summaryTemplate)
        : undefined

      const lines: string[] = []

      if (summaryTemplate) {
        lines.push(summaryTemplate.replace(/\{rowCount\}/g, String(rows.length)))
        lines.push('')
      }

      for (const row of rows) {
        lines.push(formatRow(rowTemplate, row as Record<string, unknown>))
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] }
    },
  }
}

/**
 * 从 SQL 工具定义列表批量创建 AgentTool 数组
 */
export function createSqlTools(defs: CustomSqlToolDef[], context: ToolContext): AgentTool<any>[] {
  return defs.map((def) => createSqlTool(def, context))
}
