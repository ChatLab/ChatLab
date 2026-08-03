import type { JsonSchema, ToolDefinition } from './types'
import { isChineseLocale } from './utils/format'

interface EnglishToolMetadata {
  description: string
  properties?: Record<string, string>
}

const ENGLISH_TOOL_METADATA: Record<string, EnglishToolMetadata> = {
  get_chat_overview: {
    description:
      'Get a chat overview including its name, platform, message and member counts, time range, and most active members.',
    properties: { top_n: 'Number of most active members to return. Defaults to 10.' },
  },
  search_messages: {
    description:
      'Search chat messages by keywords, with optional time-range and sender filters. Use this for topic or keyword lookup.',
    properties: {
      keywords: 'Keywords to search for.',
      sender_id: 'Filter by sender ID obtained from get_members.',
      limit: 'Maximum number of messages to return.',
      start_time: 'Start time in YYYY-MM-DD HH:mm format.',
      end_time: 'End time in YYYY-MM-DD HH:mm format.',
    },
  },
  deep_search_messages: {
    description:
      'Search messages using slower substring matching. Use this for exact phrase matches or when regular search misses results.',
    properties: {
      keywords: 'Keywords to search for.',
      sender_id: 'Filter by sender ID obtained from get_members.',
      limit: 'Maximum number of messages to return.',
      start_time: 'Start time in YYYY-MM-DD HH:mm format.',
      end_time: 'End time in YYYY-MM-DD HH:mm format.',
    },
  },
  get_recent_messages: {
    description:
      'Get messages from a specified time range. Use this for questions such as what people have discussed recently.',
    properties: {
      limit: 'Maximum number of messages to return.',
      start_time: 'Start time in YYYY-MM-DD HH:mm format.',
      end_time: 'End time in YYYY-MM-DD HH:mm format.',
    },
  },
  get_message_context: {
    description: 'Get the surrounding chat messages for one or more message IDs.',
    properties: {
      message_ids: 'Message IDs whose surrounding context should be returned.',
      context_size: 'Number of messages to include before and after each message. Defaults to 20.',
    },
  },
  get_segment_messages: {
    description: 'Get the complete message list for a conversation segment found with get_segment_summaries.',
    properties: {
      segment_id: 'Segment ID obtained from get_segment_summaries.',
      limit: 'Maximum number of messages to return.',
    },
  },
  get_members: {
    description: 'Get chat members with their basic information, aliases, and message counts.',
    properties: {
      search: 'Filter members by name, alias, or platform ID.',
      limit: 'Maximum number of members to return.',
    },
  },
  get_member_stats: {
    description: 'Get the member activity ranking with message counts and percentages.',
    properties: { top: 'Number of most active members to return.' },
  },
  get_time_stats: {
    description: 'Get chat activity grouped by hour, weekday, day, or month.',
    properties: {
      type: 'Grouping type: hourly, weekday, daily, or monthly.',
      start_time: 'Start time in YYYY-MM-DD HH:mm format.',
      end_time: 'End time in YYYY-MM-DD HH:mm format.',
    },
  },
  get_conversation_between: {
    description:
      'Get messages exchanged between two members. Obtain both member IDs from get_members before calling this tool.',
    properties: {
      member_id_1: 'First member ID obtained from get_members.',
      member_id_2: 'Second member ID obtained from get_members.',
      limit: 'Maximum number of messages to return.',
      start_time: 'Start time in YYYY-MM-DD HH:mm format.',
      end_time: 'End time in YYYY-MM-DD HH:mm format.',
    },
  },
  get_member_name_history: {
    description: "Get a member's nickname change history.",
    properties: { member_id: 'Member ID obtained from get_members.' },
  },
  get_schema: {
    description: 'Get the chat database schema as CREATE TABLE statements.',
  },
  execute_sql: {
    description:
      'Run a read-only SELECT query against the chat database. Use get_schema first when needed and add an explicit LIMIT.',
    properties: {
      sql: 'Read-only SELECT query to execute. Add an explicit LIMIT when possible.',
      max_rows: 'Maximum rows to return. Defaults to 1000 and is also capped by the execution context.',
    },
  },
}

function localizeInputSchema(schema: JsonSchema, properties?: Record<string, string>): JsonSchema {
  if (!properties) return schema
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([name, definition]) => [
        name,
        properties[name] ? { ...definition, description: properties[name] } : definition,
      ])
    ),
  }
}

export function getLocalizedToolMetadata(
  tool: ToolDefinition,
  locale?: string
): Pick<ToolDefinition, 'description' | 'inputSchema'> {
  if (isChineseLocale(locale)) return { description: tool.description, inputSchema: tool.inputSchema }
  const metadata = ENGLISH_TOOL_METADATA[tool.name]
  if (!metadata) return { description: tool.description, inputSchema: tool.inputSchema }
  return {
    description: metadata.description,
    inputSchema: localizeInputSchema(tool.inputSchema, metadata.properties),
  }
}
