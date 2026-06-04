/**
 * SQL 查询工具
 *
 * 对聊天数据库执行只读 SQL 查询。
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    sql: {
      type: 'string',
      description: '要执行的 SELECT SQL 查询语句',
    },
  },
  required: ['sql'],
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const sql = params.sql as string

  try {
    const result = await context.dataProvider!.executeSql(sql)
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
  description: '对聊天数据库执行只读 SELECT 查询。使用前可先调用 get_schema 查看表结构。',
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
