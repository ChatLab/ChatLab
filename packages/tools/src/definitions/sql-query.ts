/**
 * SQL 查询工具
 *
 * 对聊天数据库执行只读 SQL 查询。
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { resolveMessageLimit } from '../utils/limits'

interface SqlResultLike {
  rows?: unknown[]
  rowCount?: number
  truncated?: boolean
}

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    sql: {
      type: 'string',
      description: '要执行的 SELECT SQL 查询语句。建议显式添加 LIMIT，工具输出仍会被 max_rows 截断。',
    },
    max_rows: {
      type: 'number',
      description: '最多返回多少行，默认 1000；还会受调用上下文的消息上限限制。',
    },
  },
  required: ['sql'],
}

function clampSqlResultRows(result: unknown, maxRows: number): unknown {
  // provider 理论上会截断；这里做二次保护，防止外部适配层返回过大结果污染上下文。
  if (!result || typeof result !== 'object' || maxRows <= 0) return result

  const resultLike = result as SqlResultLike
  if (!Array.isArray(resultLike.rows) || resultLike.rows.length <= maxRows) return result

  return {
    ...resultLike,
    rows: resultLike.rows.slice(0, maxRows),
    rowCount: maxRows,
    truncated: true,
  }
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const sql = params.sql as string
  const maxRows = resolveMessageLimit(params.max_rows, 1000, context.maxMessagesLimit)

  try {
    const result = clampSqlResultRows(await context.dataProvider!.executeSql(sql, { maxRows }), maxRows)
    return {
      content: JSON.stringify(result),
      data: result,
    }
  } catch (err) {
    return {
      content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
    }
  }
}

const schemaInputSchema: JsonSchema = {
  type: 'object',
  properties: {},
}

async function schemaHandler(_params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const schema = await context.dataProvider!.getSchema()
  return {
    content: JSON.stringify({ tables: schema }),
    data: schema,
  }
}

export const sqlQueryTool: ToolDefinition = {
  name: 'execute_sql',
  description:
    '对聊天数据库执行只读 SELECT 查询。使用前可先调用 get_schema 查看表结构。建议 SQL 显式添加 LIMIT；工具会按 max_rows 截断输出，避免返回过大结果集。',
  inputSchema,
  handler,
  category: 'analysis',
}

export const schemaTool: ToolDefinition = {
  name: 'get_schema',
  description: '查看聊天数据库的表结构（所有表的 CREATE TABLE 语句）',
  inputSchema: schemaInputSchema,
  handler: schemaHandler,
}
