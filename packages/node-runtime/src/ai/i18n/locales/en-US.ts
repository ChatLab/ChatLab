/**
 * AI shared translations — English
 */
export default {
  ai: {
    tools: {
      search_messages: {
        desc: 'Search chat records by keywords. This is the primary evidence tool for factual questions about keywords, member messages, or whether a topic appeared. Can specify time range and sender to filter messages. Supports minute-level time queries.',
        params: {
          keywords:
            'List of search keywords, using OR logic to match messages containing any keyword. Pass an empty array [] to filter by sender only',
          sender_id:
            'Sender member ID, used to filter messages from a specific member. Can be obtained via the get_members tool',
          limit: 'Message count limit, default 1000, max 50000',
          year: 'Filter messages by year, e.g. 2024',
          month: 'Filter messages by month (1-12), use with year',
          day: 'Filter messages by day (1-31), use with year and month',
          hour: 'Filter messages by hour (0-23), use with year, month, and day',
          start_time:
            'Start time, format "YYYY-MM-DD HH:mm", e.g. "2024-03-15 14:00". Overrides year/month/day/hour when specified',
          end_time:
            'End time, format "YYYY-MM-DD HH:mm", e.g. "2024-03-15 18:30". Overrides year/month/day/hour when specified',
        },
      },
      deep_search_messages: {
        desc: 'Exact substring match search for chat records. Slower but never misses any message containing the keyword. Use when search_messages results are insufficient, when verifying whether a phrase really exists, or when searching partial words or single characters.',
        params: {
          keywords: 'List of search keywords, using substring match (LIKE). Returns messages matching any keyword',
          sender_id: 'Sender member ID for filtering messages from a specific member',
          limit: 'Message count limit, default 1000, max 50000',
          year: 'Filter messages by year, e.g. 2024',
          month: 'Filter messages by month (1-12), use with year',
          day: 'Filter messages by day (1-31), use with year and month',
          hour: 'Filter messages by hour (0-23), use with year, month, and day',
          start_time: 'Start time, format "YYYY-MM-DD HH:mm". Overrides year/month/day/hour when specified',
          end_time: 'End time, format "YYYY-MM-DD HH:mm". Overrides year/month/day/hour when specified',
        },
      },
      get_recent_messages: {
        desc: 'Get chat messages within a specified time period. This is the preferred evidence tool for overview questions like "what has everyone been chatting about recently", "what was discussed in month X", and latest content after new records were appended. Supports minute-level time queries.',
        params: {
          limit: 'Message count limit, default 100 (saves tokens, can be increased as needed)',
          year: 'Filter messages by year, e.g. 2024',
          month: 'Filter messages by month (1-12), use with year',
          day: 'Filter messages by day (1-31), use with year and month',
          hour: 'Filter messages by hour (0-23), use with year, month, and day',
          start_time:
            'Start time, format "YYYY-MM-DD HH:mm", e.g. "2024-03-15 14:00". Overrides year/month/day/hour when specified',
          end_time:
            'End time, format "YYYY-MM-DD HH:mm", e.g. "2024-03-15 18:30". Overrides year/month/day/hour when specified',
        },
      },
      get_chat_overview: {
        desc: 'Get basic overview of the chat: name, platform, type, total messages, total members, time range, and top active members. Use this before analysis or after appended records to confirm the current database range.',
        params: {
          top_n: 'Return top N active members, default 10',
        },
      },
      get_member_stats: {
        desc: 'Get member activity statistics. Suitable for questions like "who is the most active" or "who sends the most messages".',
        params: {
          top_n: 'Return top N members, default 10',
        },
      },
      get_time_stats: {
        desc: 'Get time distribution statistics of chat activity. Suitable for questions like "when is the group most active" or "what time do people usually chat".',
        params: {
          type: 'Statistics type: hourly (by hour), weekday (by day of week), daily (by date)',
        },
      },
      get_members: {
        desc: 'Get group member list, including basic info, aliases, and message statistics. Suitable for queries like "who is in the group", "what is someone\'s alias", or "whose ID is xxx".',
        params: {
          search: 'Optional search keyword to filter by member nickname, alias, or platform ID',
          limit: 'Member count limit, returns all by default',
        },
      },
      get_member_name_history: {
        desc: 'Get member name change history. Suitable for questions like "what was someone\'s previous name", "name changes", or "former names". Requires member ID from get_members tool first.',
        params: {
          member_id: 'Member database ID, can be obtained via get_members tool',
        },
      },
      get_conversation_between: {
        desc: 'Get conversation records between two group members. Suitable for questions like "what did A and B talk about" or "view the conversation between two people". Requires member IDs from get_members first. Supports minute-level time queries.',
        params: {
          member_id_1: 'Database ID of the first member',
          member_id_2: 'Database ID of the second member',
          limit: 'Message count limit, default 100',
          start_time:
            'Start time, format "YYYY-MM-DD HH:mm", e.g. "2024-03-15 14:00". Overrides year/month/day/hour when specified',
          end_time:
            'End time, format "YYYY-MM-DD HH:mm", e.g. "2024-03-15 18:30". Overrides year/month/day/hour when specified',
        },
      },
      get_message_context: {
        desc: 'Get surrounding context messages for a given message ID. Use it to verify facts around specific quoted messages, such as what was discussed before and after a message or whether a phrase has context. Supports single or batch message IDs.',
        params: {
          message_ids:
            'List of message IDs to query context for. Can be single or multiple IDs. Message IDs can be obtained from search_messages and other tool results',
          context_size: 'Context size, i.e. how many messages before and after to retrieve, default 20',
        },
      },
      search_segments: {
        desc: 'Search chat segments (conversation segments). Segments are conversation units automatically split by message time intervals. Suitable for finding discussions on specific topics or understanding how many conversations occurred in a time period. Returns matching segments with a 5-message preview each.',
        params: {
          keywords: 'Optional keyword list, only returns segments containing these keywords (OR logic)',
          limit: 'Session count limit, default 20',
          year: 'Filter segments by year, e.g. 2024',
          month: 'Filter segments by month (1-12), use with year',
          day: 'Filter segments by day (1-31), use with year and month',
          start_time: 'Start time, format "YYYY-MM-DD HH:mm", e.g. "2024-03-15 14:00"',
          end_time: 'End time, format "YYYY-MM-DD HH:mm", e.g. "2024-03-15 18:30"',
        },
      },
      get_segment_messages: {
        desc: 'Get the complete message list for a specific segment. Used to get full context after finding a relevant segment via search_segments. Returns all messages and participant information.',
        params: {
          segment_id: 'Segment ID, can be obtained from search_segments results',
          limit: 'Message count limit, default 1000. Can be limited for very long segments to save tokens',
        },
      },
      get_segment_summaries: {
        desc: `Get segment summary list to quickly understand discussion topics in chat history.

Use cases:
1. Understand what topics have been discussed recently
2. Search for discussed topics by keyword
3. Overview questions like "has the group discussed travel"

Returned summaries are brief descriptions of each segment, helping quickly locate segments of interest. Use get_segment_messages for details.`,
        params: {
          keywords: 'Keyword list to search within summaries (OR logic)',
          limit: 'Session count limit, default 20',
          year: 'Filter segments by year',
          month: 'Filter segments by month (1-12)',
          day: 'Filter segments by day (1-31)',
          start_time: 'Start time, format "YYYY-MM-DD HH:mm"',
          end_time: 'End time, format "YYYY-MM-DD HH:mm"',
        },
      },
      // ===== SQL Analysis Tools =====
      message_type_breakdown: {
        desc: 'Break down message types over the last N days (text, image, voice, emoji, etc.). Useful for understanding communication preferences.',
        params: { days: 'Number of recent days to analyze' },
        rowTemplate: '{type_name}: {msg_count} messages ({percentage}%)',
        summaryTemplate: 'Message type distribution ({rowCount} types):',
        fallback: 'No messages found in this time range',
      },
      peak_chat_hours_by_member: {
        desc: "Analyze a specific member's hourly message distribution over the last N days to find their most active hours. Requires member_id from get_members.",
        params: {
          member_id: 'Member ID (from get_members)',
          days: 'Number of recent days to analyze',
        },
        rowTemplate: '{hour}:00 — {msg_count} messages',
        summaryTemplate: 'Message volume by hour ({rowCount} active hours):',
        fallback: 'This member has no messages in the specified time range',
      },
      member_activity_trend: {
        desc: "View a specific member's daily message count trend over the last N days. Useful for observing whether someone is becoming more or less active. Requires member_id from get_members.",
        params: {
          member_id: 'Member ID (from get_members)',
          days: 'Number of recent days to view',
        },
        rowTemplate: '{day}: {msg_count} messages',
        summaryTemplate: 'This member was active on {rowCount} days:',
        fallback: 'This member has no messages in the specified time range',
      },
      silent_members: {
        desc: 'Detect "silent members" who haven\'t sent messages for more than N days. Useful for identifying at-risk users in community management.',
        params: { days: 'Days of silence to qualify' },
        rowTemplate: '{name} — silent for {silent_days} days',
        summaryTemplate: 'Found {rowCount} silent members:',
        fallback: 'No members found who have been silent for that long. Community engagement is healthy!',
      },
      reply_interaction_ranking: {
        desc: 'Analyze reply interaction rankings in the group — who replies to whom the most. Useful for discovering core interaction relationships and key opinion leaders.',
        params: {
          days: 'Number of recent days to analyze',
          limit: 'Number of top interaction pairs to return',
        },
        rowTemplate: '{replier_name} → {original_name}: {reply_count} replies',
        summaryTemplate: 'Top {rowCount} reply interactions:',
        fallback: 'No reply interactions found in this time range',
      },
      mutual_interaction_pairs: {
        desc: 'Find the most frequently interacting member pairs, based on bidirectional message timing (if one person speaks and another responds within 5 minutes, it counts as an interaction). Useful for discovering close friendships.',
        params: {
          days: 'Number of recent days to analyze',
          limit: 'Number of top pairs to return',
        },
        rowTemplate: '{member_a} ↔ {member_b}: {interaction_count} interactions',
        summaryTemplate: 'Top {rowCount} most interactive pairs:',
        fallback: 'No significant interaction patterns detected in this time range',
      },
      member_message_length_stats: {
        desc: 'Analyze average message length per member (text messages only). Longer messages often indicate more thoughtful communication. Useful for finding deep communicators.',
        params: {
          days: 'Number of recent days to analyze',
          top_n: 'Number of top members to return',
        },
        rowTemplate: '{name} — avg {avg_length} chars/msg ({msg_count} msgs, max {max_length} chars)',
        summaryTemplate: 'Message length Top {rowCount} (longer = more thoughtful):',
        fallback: 'Not enough text message data in this time range',
      },
      unanswered_messages: {
        desc: 'Find messages in the last N days that may not have been replied to — potential unresolved customer issues. Only counts text messages over 10 characters (filters out short greetings).',
        params: {
          days: 'Number of recent days to search',
          limit: 'Maximum number of results',
        },
        rowTemplate: '[{send_time}] {sender_name}: {content_preview}',
        summaryTemplate: 'Found {rowCount} potentially unanswered messages:',
        fallback: 'All messages have been replied to in this time range. Great service quality!',
      },
      daily_active_members: {
        desc: 'Count daily unique active members (DAU) and message volume to observe community vitality trends. Useful for "how is the group activity trending" or "how many people are chatting recently".',
        params: { days: 'Number of recent days to analyze' },
        rowTemplate: '{day}: {active_members} active, {msg_count} messages',
        summaryTemplate: 'Daily active members trend for {rowCount} days:',
        fallback: 'No messages in this time range',
      },
      conversation_initiator_stats: {
        desc: 'Count how many times each member initiated a conversation (was the first sender in a segment). Requires segment index to be generated.',
        params: {
          days: 'Number of recent days to analyze',
          limit: 'Number of top members to return',
        },
        rowTemplate: '{name}: initiated {initiated_count} topics',
        summaryTemplate: 'Topic initiator Top {rowCount}:',
        fallback: 'No segment records in this time range. Session index may need to be generated first.',
      },
      activity_heatmap: {
        desc: 'Return a weekday × hour message count matrix for generating activity heatmaps. weekday: 0=Sun, 1=Mon, ..., 6=Sat.',
        params: { days: 'Number of recent days to analyze' },
        rowTemplate: 'Weekday {weekday} {hour}:00 — {msg_count} messages',
        summaryTemplate: 'Activity heatmap data ({rowCount} time slots with messages):',
        fallback: 'No messages in this time range',
      },
      response_time_analysis: {
        desc: 'Analyze response times between messages, showing median and average reply speed per member. Useful for "how quickly do people reply" or "who replies the fastest".',
        params: {
          days: 'Number of recent days to analyze',
          top_n: 'Number of top members to return',
        },
      },
      keyword_frequency: {
        desc: 'Segment text messages and rank high-frequency keywords. Supports Chinese, English, and Japanese. Useful for "what do people talk about most" or "what are the hot keywords".',
        params: {
          days: 'Number of recent days to analyze',
          top_n: 'Number of top keywords to return',
        },
      },
      get_schema: {
        desc: 'Inspect the chat database schema. Use it before charting or custom SQL when table or field names are uncertain.',
        params: {},
      },
      render_chart: {
        desc: 'Generate a native ChatLab chart from read-only SQL and ChartSpec v1. Supports bar, line, pie, and heatmap. Do not output HTML, JavaScript, SVG, ECharts options, or rendering code.',
        params: {
          sql: 'Read-only SELECT or WITH SELECT SQL. It must return fields referenced by ChartSpec encoding.',
          params: 'Named SQL parameters. Use an empty object when no parameters are needed.',
          chartSpec: 'ChartSpec v1 with version, type, title, and encoding.',
          maxRows: 'Maximum chart query rows. Default 1000.',
        },
      },
    },

    // ===== AI Agent system prompts =====
    agent: {
      answerWithoutTools: 'Please answer based on the information already retrieved, do not call any more tools.',
      toolError: 'Error: {{error}}',
      currentDateIs: 'Current date is',
      chatContext: {
        private: 'conversation',
        group: 'group chat',
      },
      ownerNote: `Current user identity:
- The user's identity in this {{chatContext}} is "{{displayName}}" (platformId: {{platformId}})
- When the user refers to "I" or "my", it refers to "{{displayName}}"
- When querying "my" messages, use the sender_id parameter to filter for this member
`,
      memberNotePrivate: `Member query strategy:
- Private chats only have two participants, so the member list can be directly obtained
- When the user refers to "the other party" or "he/she", get the other participant's information via get_members
`,
      memberNoteGroup: `Member query strategy:
- When the user refers to specific group members (e.g., "what did John say", "Mary's messages"), first call get_members to get the member list
- Group members have three names: accountName (original nickname), groupNickname (group nickname), aliases (user-defined aliases)
- The search parameter of get_members can be used for fuzzy searching these three names
- Once a member is found, use their id field as the sender_id parameter for search_messages to retrieve their messages
`,
      mentionedMembersNote:
        'Members explicitly @-selected by the user in this round (member_id can be used directly without another search):',
      timeParamsIntro: 'Time parameters: use start_time/end_time to specify the range, format "YYYY-MM-DD HH:mm"',
      defaultYearNote: 'When no time range is specified, queries default to all data. Current year is {{year}}.',
      dataSnapshotNote:
        'Current chat database snapshot: {{name}} ({{platform}}), {{totalMessages}} total messages, {{totalMembers}} members, time range {{firstMessageDate}} ~ {{lastMessageDate}}. This snapshot only helps judge data coverage; concrete chat facts still require tool retrieval from the current database.',
      evidencePolicy: `Evidence policy:
- AI conversation history, prior AI replies, and compressed summaries are only for understanding the user's intent; they are not evidence for chat-record facts.
- Whenever the user asks about chat content, recent topics, what someone said, rankings/statistics, whether a topic appeared, or asks for exact quotes, first call an appropriate data tool to retrieve the current database.
- If new chat records were appended, the current database may differ from old window history; prefer get_chat_overview or get_recent_messages/search_messages to get fresh evidence.
- Only messages, statistics, or database overviews returned by tools may be used as factual basis. If tools do not return enough evidence, say the data is insufficient and do not fabricate nonexistent chat records.`,
      currentTask: 'Current Task',
      skillPriorityNote:
        'Note: When executing this task, prioritize the output format requirements below. This can override your usual response style.',
      responseInstruction:
        "Based on the user's question, select appropriate tools to retrieve data, then provide an answer based on the data.",
      fallbackRoleDefinition: {
        group: `You are a professional group chat analysis assistant.
Your task is to help users understand and analyze their group chat data.

## Response Requirements
1. Answer based on data returned by tools, do not fabricate information
2. If data is insufficient to answer, please state so
3. Keep answers concise and clear, use Markdown format`,
        private: `You are a professional private chat analysis assistant.
Your task is to help users understand and analyze their private chat data.

## Response Requirements
1. Answer based on data returned by tools, do not fabricate information
2. If data is insufficient to answer, please state so
3. Keep answers concise and clear, use Markdown format`,
      },
    },
  },

  llm: {
    notConfigured: 'LLM service not configured. Please set up an API Key in settings first.',
    maxConfigs: 'Maximum of {{count}} configurations allowed',
    configNotFound: 'Configuration not found',
    noActiveConfig: 'No active configuration',
    callFailed: 'LLM call failed. Please check your model configuration.',
    genericProviderName: 'API provider',
    rawErrorLabel: 'Raw error',
  },

  summary: {
    segmentNotFound: 'Session not found or database could not be opened',
    tooFewMessages: 'Message count less than {{count}}, no need to generate summary',
    tooFewValidMessages: 'Valid message count less than {{count}}, no need to generate summary',
    segmentNotExist: 'Session not found',
    messagesTooFew: 'Too few messages',
    validMessagesTooFew: 'Too few valid messages',
    systemPromptDirect: 'You are a conversation summarization expert. Summarize conversations concisely.',
    systemPromptMerge:
      'You are a conversation summarization expert skilled at merging multiple summaries into a coherent overview.',
  },
}
