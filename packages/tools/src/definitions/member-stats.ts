/**
 * 成员统计工具
 *
 * 获取成员活跃度排行和统计信息。
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    top: {
      type: 'number',
      description: '返回前 N 个活跃成员',
      default: 20,
    },
  },
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const top = (params.top as number) || 20
  const members = await context.dataProvider!.getMemberStats({ timeFilter: context.timeFilter, top })

  const data = {
    total: members.length,
    members: members.map((m) => ({
      name: m.name,
      messageCount: m.messageCount,
      percentage: m.percentage,
    })),
  }

  return {
    content: JSON.stringify(data),
    data,
  }
}

export const memberStatsTool: ToolDefinition = {
  name: 'get_member_stats',
  description: '获取成员活跃度排行，包括消息数量和占比',
  inputSchema,
  handler,
  category: 'analysis',
}
