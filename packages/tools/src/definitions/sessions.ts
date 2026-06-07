/**
 * 会话列表工具
 *
 * MCP 场景下列出所有可用的聊天会话。
 * 这是 MCP 场景下的完整聊天记录发现工具，不是 segment 搜索工具。
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { getSessionMeta, getSessionOverview } from '@openchatlab/core'
import type { DatabaseAdapter } from '@openchatlab/core'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    keyword: {
      type: 'string',
      description: '按名称筛选会话（可选）',
    },
  },
}

export interface SessionListContext extends ToolExecutionContext {
  listSessionIds: () => string[]
  openDb: (sessionId: string) => DatabaseAdapter | null
}

function handler(_params: Record<string, unknown>, context: SessionListContext): ToolResult {
  const keyword = (_params.keyword as string | undefined)?.toLowerCase()
  const sessionIds = context.listSessionIds()

  const sessions = sessionIds
    .map((id) => {
      const db = context.openDb(id)
      if (!db) return null
      const meta = getSessionMeta(db)
      if (!meta) return null
      if (keyword && !meta.name.toLowerCase().includes(keyword)) return null
      const overview = getSessionOverview(db)
      return { id, ...meta, ...overview }
    })
    .filter(Boolean)

  return {
    content: JSON.stringify({ total: sessions.length, sessions }),
    data: sessions,
  }
}

export const sessionsListTool: ToolDefinition = {
  name: 'list_sessions',
  description: '列出所有可用的聊天会话，返回会话名称、平台、消息数等基本信息',
  inputSchema,
  handler: handler as ToolDefinition['handler'],
}
