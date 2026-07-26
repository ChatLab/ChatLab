import type { JsonSchema, ToolDefinition, ToolExecutionContext, ToolResult } from '../types'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    keyword: { type: 'string', description: '用于查找会话片段的关键词' },
    limit: { type: 'number', description: '最多返回多少个片段，默认 20，最大 50' },
  },
  required: ['keyword'],
}

interface SearchSegmentRow {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  participants: string | null
  preview: string | null
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const keyword = String(params.keyword ?? '').trim()
  if (!keyword) return { content: JSON.stringify({ segments: [] }), data: [] }
  const limit = Math.max(1, Math.min(Number(params.limit) || 20, 50))
  const rows = await context.dataProvider!.executeParameterizedSql<SearchSegmentRow>(
    `WITH hits AS (
       SELECT DISTINCT mc.segment_id
       FROM message m
       JOIN message_context mc ON mc.message_id = m.id
       WHERE m.content LIKE '%' || :keyword || '%'
     )
     SELECT s.id,
            s.start_ts AS startTs,
            s.end_ts AS endTs,
            s.message_count AS messageCount,
            GROUP_CONCAT(DISTINCT COALESCE(mb.group_nickname, mb.account_name, mb.platform_id)) AS participants,
            (
              SELECT SUBSTR(hit.content, 1, 240)
              FROM message hit
              JOIN message_context hit_context ON hit_context.message_id = hit.id
              WHERE hit_context.segment_id = s.id AND hit.content LIKE '%' || :keyword || '%'
              ORDER BY hit.ts ASC, hit.id ASC
              LIMIT 1
            ) AS preview
     FROM hits
     JOIN segment s ON s.id = hits.segment_id
     JOIN message_context mc ON mc.segment_id = s.id
     JOIN message m ON m.id = mc.message_id
     JOIN member mb ON mb.id = m.sender_id
     GROUP BY s.id
     ORDER BY s.start_ts DESC
     LIMIT :limit`,
    { keyword, limit }
  )
  const segments = rows.map((row) => ({
    ...row,
    participants: row.participants ? row.participants.split(',').slice(0, 20) : [],
  }))
  return { content: JSON.stringify({ segments }), data: segments }
}

export const searchSegmentsTool: ToolDefinition = {
  name: 'search_segments',
  description: '按关键词查找本地会话片段，返回时间、参与者、消息数和有限预览；不依赖 AI 摘要或 RAG。',
  inputSchema,
  handler,
  category: 'analysis',
}
