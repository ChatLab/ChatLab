/**
 * 主进程英文翻译
 */
export default {
  // ===== Common =====
  common: {
    error: 'Error',
  },

  // ===== P0: Update dialogs =====
  update: {
    newVersionTitle: 'New version v{{version}} available',
    newVersionMessage: 'New version v{{version}} available',
    newVersionDetail: 'Would you like to download and install the new version?',
    downloadNow: 'Download Now',
    cancel: 'Cancel',
    downloadComplete: 'Download Complete',
    readyToInstall: 'The new version is ready. Install now?',
    install: 'Install',
    remindLater: 'Remind Later',
    installOnQuit: 'Later (auto-install on quit)',
    upToDate: 'You are up to date',
  },

  // ===== P0: File/directory dialogs =====
  dialog: {
    selectChatFile: 'Select Chat Record File',
    chatRecords: 'Chat Records',
    allFiles: 'All Files',
    import: 'Import',
    selectDirectory: 'Select Directory',
    selectFolder: 'Select Folder',
    selectFolderError: 'Error selecting folder: ',
  },

  // ===== P1: Database migrations =====
  database: {
    migrationV1Desc: 'Add owner_id field to meta table',
    migrationV1Message: 'Support "Owner" feature to set your identity in the member list',
    migrationV2Desc: 'Add roles, reply_to_message_id, platform_message_id fields',
    migrationV2Message: 'Support member roles, message reply relationships and reply preview',
    migrationV3Desc: 'Add session index tables (chat_session, message_context) and session_gap_threshold field',
    migrationV3Message: 'Support session timeline browsing and AI-enhanced analysis',
    integrityError:
      'Database structure is incomplete: missing meta table. Please delete this database file and re-import.',
    checkFailed: 'Database check failed: {{error}}',
  },

  // ===== Tool system =====
  tools: {
    notRegistered: 'Tool "{{toolName}}" is not registered',
  },

  // ===== P2: AI Tool definitions (Function Calling) =====
  ai: {
    tools: {
      search_messages: {
        desc: 'Search group chat records by keywords. Suitable for finding specific topics or keyword-related chat content. Can specify time range and sender to filter messages. Supports minute-level time queries.',
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
      get_recent_messages: {
        desc: 'Get chat messages within a specified time period. Suitable for overview questions like "what has everyone been chatting about recently" or "what was discussed in month X". Supports minute-level time queries.',
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
          year: 'Filter messages by year',
          month: 'Filter messages by month (1-12), use with year',
          day: 'Filter messages by day (1-31), use with year and month',
          hour: 'Filter messages by hour (0-23), use with year, month, and day',
          start_time:
            'Start time, format "YYYY-MM-DD HH:mm", e.g. "2024-03-15 14:00". Overrides year/month/day/hour when specified',
          end_time:
            'End time, format "YYYY-MM-DD HH:mm", e.g. "2024-03-15 18:30". Overrides year/month/day/hour when specified',
        },
      },
      get_message_context: {
        desc: 'Get surrounding context messages for a given message ID. Suitable for viewing what was discussed before and after a specific message. Supports single or batch message IDs.',
        params: {
          message_ids:
            'List of message IDs to query context for. Can be single or multiple IDs. Message IDs can be obtained from search_messages and other tool results',
          context_size: 'Context size, i.e. how many messages before and after to retrieve, default 20',
        },
      },
      search_sessions: {
        desc: 'Search chat sessions (conversation segments). Sessions are conversation units automatically split by message time intervals. Suitable for finding discussions on specific topics or understanding how many conversations occurred in a time period. Returns matching sessions with a 5-message preview each.',
        params: {
          keywords: 'Optional keyword list, only returns sessions containing these keywords (OR logic)',
          limit: 'Session count limit, default 20',
          year: 'Filter sessions by year, e.g. 2024',
          month: 'Filter sessions by month (1-12), use with year',
          day: 'Filter sessions by day (1-31), use with year and month',
          start_time: 'Start time, format "YYYY-MM-DD HH:mm", e.g. "2024-03-15 14:00"',
          end_time: 'End time, format "YYYY-MM-DD HH:mm", e.g. "2024-03-15 18:30"',
        },
      },
      get_session_messages: {
        desc: 'Get the complete message list for a specific session. Used to get full context after finding a relevant session via search_sessions. Returns all messages and participant information.',
        params: {
          session_id: 'Session ID, can be obtained from search_sessions results',
          limit: 'Message count limit, default 1000. Can be limited for very long sessions to save tokens',
        },
      },
      get_session_summaries: {
        desc: `Get session summary list to quickly understand discussion topics in chat history.

Use cases:
1. Understand what topics have been discussed recently
2. Search for discussed topics by keyword
3. Overview questions like "has the group discussed travel"

Returned summaries are brief descriptions of each session, helping quickly locate sessions of interest. Use get_session_messages for details.`,
        params: {
          keywords: 'Keyword list to search within summaries (OR logic)',
          limit: 'Session count limit, default 20',
          year: 'Filter sessions by year',
          month: 'Filter sessions by month (1-12)',
          day: 'Filter sessions by day (1-31)',
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
      timeParamsIntro: 'Time parameters: combine year/month/day/hour based on user mention',
      timeParamExample1: '"October" → year: {{year}}, month: 10',
      timeParamExample2: '"October 1st" → year: {{year}}, month: 10, day: 1',
      timeParamExample3: '"October 1st 3 PM" → year: {{year}}, month: 10, day: 1, hour: 15',
      defaultYearNote:
        'If year is not specified, defaults to {{year}}. If the month has not yet occurred, {{prevYear}} is used.',
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

  // ===== P3: LLM config =====
  llm: {
    notConfigured: 'LLM service not configured. Please set up an API Key in settings first.',
    maxConfigs: 'Maximum of {{count}} configurations allowed',
    configNotFound: 'Configuration not found',
    noActiveConfig: 'No active configuration',
    callFailed: 'LLM call failed. Please check your model configuration.',
  },

  // ===== P4: Summary generation =====
  summary: {
    sessionNotFound: 'Session not found or database could not be opened',
    tooFewMessages: 'Message count less than {{count}}, no need to generate summary',
    tooFewValidMessages: 'Valid message count less than {{count}}, no need to generate summary',
    sessionNotExist: 'Session not found',
    messagesTooFew: 'Too few messages',
    validMessagesTooFew: 'Too few valid messages',
    systemPromptDirect: 'You are a conversation summarization expert. Summarize conversations concisely.',
    systemPromptMerge:
      'You are a conversation summarization expert skilled at merging multiple summaries into a coherent overview.',
  },
}
