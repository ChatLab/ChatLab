import type { JsonSchema, ToolDefinition } from './types'
import { isChineseLocale } from './utils/format'

interface EnglishToolMetadata {
  /** Omitted when the definition description is already English. */
  description?: string
  properties?: Record<string, string>
}

/**
 * English tool/parameter descriptions handed to the LLM on non-Chinese locales.
 *
 * Only translates text the definitions write in Chinese: tools whose definition description and
 * parameter descriptions are already English have no entry here, and a tool with an English
 * description but Chinese parameters lists only `properties`. Copying English text into this table
 * would let the two copies drift apart (tool-metadata.test.ts enforces both rules).
 */
export const ENGLISH_TOOL_METADATA: Record<string, EnglishToolMetadata> = {
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
  get_segment_summaries: {
    description:
      'Get the list of segment summaries for a quick view of the topics discussed in the chat history. Topics that have been discussed can be searched by keyword.',
    properties: {
      keywords: 'Filter summary content by keywords.',
      limit: 'Maximum number of segments to return. Defaults to 20.',
      start_time: 'Start time in YYYY-MM-DD HH:mm format.',
      end_time: 'End time in YYYY-MM-DD HH:mm format.',
    },
  },
  response_time_analysis: {
    description:
      'Analyze the response-speed ranking of chat members, based on the median and mean of their reply intervals.',
    properties: {
      days: 'Number of most recent days of data to analyze. Defaults to 30.',
      top_n: 'Number of top-ranked members to return. Defaults to 10.',
    },
  },
  keyword_frequency: {
    description:
      'Count the most frequent keywords in the chat, analyzing message content through NLP word segmentation.',
    properties: {
      days: 'Number of most recent days of data to analyze. Defaults to 30.',
      top_n: 'Number of top frequent words to return. Defaults to 50.',
    },
  },
  semantic_search_current_chat: {
    properties: {
      query:
        'Semantic search query. Rewrite it into a natural-language description suited to searching the current chat history (centred on the facts/people/places/events/past mentions that need to be confirmed).',
      max_results:
        'Expected number of relevant excerpts to return; optional. When omitted, the default configured by the user is used; it may be raised according to question complexity, with a hard limit of 20.',
    },
  },
  retrieve_chat_evidence: {
    properties: {
      query:
        'The question or retrieval target that has to be confirmed with chat evidence, for example "how many times have we travelled to Leshan".',
      criteria:
        'Judgement criteria: what counts and what does not. Counting or judgement questions should fill this in, for example "counts: evidence of an actual trip/arrival/stay; does not count: plans only, travel guides, other people\'s experiences, general chatter".',
      keywords:
        'Keyword list, given explicitly by you (the tool does not expand synonyms). Used by the hybrid/keyword modes for exact recall.',
      mode: 'auto (default)/hybrid (semantic + keyword)/semantic (semantic only)/keyword (keyword only). Counting historical facts usually uses hybrid.',
      max_results: 'Expected number of excerpts returned by the semantic path, with a hard limit of 20.',
      start_time: 'Start time in YYYY-MM-DD HH:mm format.',
      end_time: 'End time in YYYY-MM-DD HH:mm format.',
    },
  },
  message_type_breakdown: {
    description:
      'Break the messages of the last N days down by message type (how many text, image, voice, sticker and other messages there are). Use this to understand communication-style preferences.',
    properties: { days: 'Number of most recent days of data to count.' },
  },
  peak_chat_hours_by_member: {
    description:
      "Analyze the hourly distribution of a given member's messages over the last N days to find their most active hours. Obtain member_id from get_members before calling this tool.",
    properties: {
      member_id: 'Member ID obtained from get_members.',
      days: 'Number of most recent days of data to count.',
    },
  },
  member_activity_trend: {
    description:
      "View the trend of a given member's daily message counts over the last N days. Use this to observe whether someone has become more active or more silent. Obtain member_id from get_members before calling this tool.",
    properties: {
      member_id: 'Member ID obtained from get_members.',
      days: 'Number of most recent days of trend to view.',
    },
  },
  silent_members: {
    description:
      'Detect "silent members" who have not spoken for more than N days. Use this in community management to find users at risk of churn.',
    properties: { days: 'Number of days without speaking that counts as silent.' },
  },
  reply_interaction_ranking: {
    description:
      'Analyze the ranking of reply interactions in the chat to find who replies to whom the most. Use this to discover the core interaction relationships and the opinion leaders in the community.',
    properties: {
      days: 'Number of most recent days of data to count.',
      limit: 'Number of top interaction pairs to return.',
    },
  },
  mutual_interaction_pairs: {
    description:
      'Find the member pairs that interact most frequently, based on the temporal proximity of two-way messages (one interaction is counted when the other party also speaks within 5 minutes of one party speaking). Use this to discover closely connected friend pairs.',
    properties: {
      days: 'Number of most recent days of data to count.',
      limit: 'Number of top pairs to return.',
    },
  },
  member_message_length_stats: {
    description:
      'Count the average message length of each member (text messages only); long messages usually mean more thoughtful communication. Use this to discover members who communicate in depth.',
    properties: {
      days: 'Number of most recent days of data to count.',
      top_n: 'Number of top-ranked members to return.',
    },
  },
  daily_active_members: {
    description:
      'Count the daily unique speakers (DAU) and message volume, used to observe how the vitality of the chat changes. Use this for questions such as "what is the chat activity trend" and "how many people have been talking recently".',
    properties: { days: 'Number of most recent days of data to count.' },
  },
  conversation_initiator_stats: {
    description:
      "Count how many times each member starts a conversation (as the sender of the conversation's first message) to find who opens topics most often.",
    properties: {
      days: 'Number of most recent days of data to count.',
      limit: 'Number of top-ranked members to return.',
    },
  },
  activity_heatmap: {
    description:
      'Return a weekday × hour matrix of message counts, suitable for generating an activity heatmap. weekday: 0=Sunday, 1=Monday, ..., 6=Saturday.',
    properties: { days: 'Number of most recent days of data to count.' },
  },
  unanswered_messages: {
    description:
      'Find messages from the last N days that were never replied to; these may be unresolved customer questions. Only text messages whose content is longer than 10 characters are counted (short greetings are filtered out).',
    properties: {
      days: 'Number of most recent days of data to search.',
      limit: 'Maximum number of messages to return.',
    },
  },
  list_sessions: {
    description:
      'List all available chat sessions, returning basic information such as session name, platform, and message count.',
    properties: { keyword: 'Filter sessions by name (optional).' },
  },
  get_session_info: {
    description:
      'Get detailed information about the current session, including its name, platform, total message count, member count, and time range.',
    properties: { include_members: 'Whether to include the member list (defaults to false).' },
  },
  search_messages_globally: {
    properties: {
      start_time: 'Start time in YYYY-MM-DD HH:mm format.',
      end_time: 'End time in YYYY-MM-DD HH:mm format.',
    },
  },
  get_cross_chat_overview: {
    properties: {
      start_time: 'Start time in YYYY-MM-DD HH:mm format.',
      end_time: 'End time in YYYY-MM-DD HH:mm format.',
    },
  },
  rank_private_contacts: {
    properties: {
      start_time: 'Start time in YYYY-MM-DD HH:mm format.',
      end_time: 'End time in YYYY-MM-DD HH:mm format.',
    },
  },
  rank_group_sessions: {
    properties: {
      start_time: 'Start time in YYYY-MM-DD HH:mm format.',
      end_time: 'End time in YYYY-MM-DD HH:mm format.',
    },
  },
  inspect_contact_sessions: {
    properties: {
      start_time: 'Start time in YYYY-MM-DD HH:mm format.',
      end_time: 'End time in YYYY-MM-DD HH:mm format.',
    },
  },
  inspect_shared_interactions: {
    properties: {
      start_time: 'Start time in YYYY-MM-DD HH:mm format.',
      end_time: 'End time in YYYY-MM-DD HH:mm format.',
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

/** Reads only the locale-independent fields, so tools bound to any execution context can be localized. */
export function getLocalizedToolMetadata(
  tool: Pick<ToolDefinition, 'name' | 'description' | 'inputSchema'>,
  locale?: string
): Pick<ToolDefinition, 'description' | 'inputSchema'> {
  if (isChineseLocale(locale)) return { description: tool.description, inputSchema: tool.inputSchema }
  const metadata = ENGLISH_TOOL_METADATA[tool.name]
  if (!metadata) return { description: tool.description, inputSchema: tool.inputSchema }
  return {
    description: metadata.description ?? tool.description,
    inputSchema: localizeInputSchema(tool.inputSchema, metadata.properties),
  }
}
