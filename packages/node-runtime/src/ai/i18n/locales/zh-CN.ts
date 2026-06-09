/**
 * AI shared translations — Simplified Chinese
 */
export default {
  ai: {
    tools: {
      search_messages: {
        desc: '根据关键词搜索聊天记录，是回答关键词、成员发言、是否出现过某话题等事实问题的主要证据工具。可以指定时间范围和发送者来筛选消息。支持精确到分钟级别的时间查询。',
        params: {
          keywords: '搜索关键词列表，会用 OR 逻辑匹配包含任一关键词的消息。如果只需要按发送者筛选，可以传空数组 []',
          sender_id: '发送者的成员 ID，用于筛选特定成员发送的消息。可以通过 get_members 工具获取成员 ID',
          limit: '返回消息数量限制，默认 1000，最大 50000',
          year: '指定年份筛选消息，如 2024',
          month: '指定月份筛选消息（1-12），需配合 year 使用',
          day: '指定日期筛选消息（1-31），需配合 year 和 month 使用',
          hour: '指定小时筛选消息（0-23），需配合 year、month、day 使用',
          start_time: '开始时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 14:00"。指定后覆盖 year/month/day/hour',
          end_time: '结束时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 18:30"。指定后覆盖 year/month/day/hour',
        },
      },
      deep_search_messages: {
        desc: '精确子串匹配搜索聊天记录，速度较慢但不会遗漏任何包含关键词的消息。当 search_messages 结果不足、需要验证某段话是否真实存在、或搜索部分词/单个字符时使用。',
        params: {
          keywords: '搜索关键词列表，使用子串匹配（LIKE），任一关键词匹配即返回',
          sender_id: '发送者的成员 ID，用于筛选特定成员发送的消息',
          limit: '返回消息数量限制，默认 1000，最大 50000',
          year: '指定年份筛选消息，如 2024',
          month: '指定月份筛选消息（1-12），需配合 year 使用',
          day: '指定日期筛选消息（1-31），需配合 year 和 month 使用',
          hour: '指定小时筛选消息（0-23），需配合 year、month、day 使用',
          start_time: '开始时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 14:00"。指定后覆盖 year/month/day/hour',
          end_time: '结束时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 18:30"。指定后覆盖 year/month/day/hour',
        },
      },
      get_recent_messages: {
        desc: '获取指定时间段内的聊天消息，是回答"最近大家聊了什么"、"X月聊了什么"、追加新记录后最新内容等概览性问题的首选证据工具。支持精确到分钟级别的时间查询。',
        params: {
          limit: '返回消息数量限制，默认 100（节省 token，可根据需要增加）',
          year: '指定年份筛选消息，如 2024',
          month: '指定月份筛选消息（1-12），需配合 year 使用',
          day: '指定日期筛选消息（1-31），需配合 year 和 month 使用',
          hour: '指定小时筛选消息（0-23），需配合 year、month、day 使用',
          start_time: '开始时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 14:00"。指定后覆盖 year/month/day/hour',
          end_time: '结束时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 18:30"。指定后覆盖 year/month/day/hour',
        },
      },
      get_chat_overview: {
        desc: '获取聊天记录的基本概览信息，包括群名/平台/类型/总消息数/总成员数/时间跨度/最活跃成员排名。适合在分析前或追加新记录后确认当前数据库范围。',
        params: {
          top_n: '返回前 N 名活跃成员，默认 10',
        },
      },
      get_member_stats: {
        desc: '获取群成员的活跃度统计数据。适用于回答"谁最活跃"、"发言最多的是谁"等问题。',
        params: {
          top_n: '返回前 N 名成员，默认 10',
        },
      },
      get_time_stats: {
        desc: '获取群聊的时间分布统计。适用于回答"什么时候最活跃"、"大家一般几点聊天"等问题。返回的 `data` 数组可直接作为 `render_chart` 的 `rows` 参数用于绘图。',
        params: {
          type: '统计类型：hourly（按小时）、weekday（按星期）、daily（按日期）',
        },
      },
      get_members: {
        desc: '获取群成员列表，包括成员的基本信息、别名和消息统计。适用于查询"群里有哪些人"、"某人的别名是什么"、"谁的QQ号是xxx"等问题。',
        params: {
          search: '可选的搜索关键词，用于筛选成员昵称、别名或QQ号',
          limit: '返回成员数量限制，默认返回全部',
        },
      },
      get_member_name_history: {
        desc: '获取成员的昵称变更历史记录。适用于回答"某人以前叫什么名字"、"某人的昵称变化"、"某人曾用名"等问题。需要先通过 get_members 工具获取成员 ID。',
        params: {
          member_id: '成员的数据库 ID，可以通过 get_members 工具获取',
        },
      },
      get_conversation_between: {
        desc: '获取两个群成员之间的对话记录。适用于回答"A和B之间聊了什么"、"查看两人的对话"等问题。需要先通过 get_members 获取成员 ID。支持精确到分钟级别的时间查询。',
        params: {
          member_id_1: '第一个成员的数据库 ID',
          member_id_2: '第二个成员的数据库 ID',
          limit: '返回消息数量限制，默认 100',
          start_time: '开始时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 14:00"。指定后覆盖 year/month/day/hour',
          end_time: '结束时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 18:30"。指定后覆盖 year/month/day/hour',
        },
      },
      get_message_context: {
        desc: '根据消息 ID 获取前后的上下文消息。适用于引用具体消息前后进行事实验证，比如"这条消息前后在聊什么"、"确认这段话是否有上下文"等。支持单个或批量消息 ID。',
        params: {
          message_ids:
            '要查询上下文的消息 ID 列表，可以是单个 ID 或多个 ID。消息 ID 可以从 search_messages 等工具的返回结果中获取',
          context_size: '上下文大小，即获取前后各多少条消息，默认 20',
        },
      },
      search_segments: {
        desc: '搜索聊天段落（对话段落）。段落是根据消息时间间隔自动切分的对话单元。适用于查找特定话题的讨论、了解某个时间段内发生了几次对话等场景。返回匹配的段落列表及每个段落的前5条消息预览。',
        params: {
          keywords: '可选的搜索关键词列表，只返回包含这些关键词的段落（OR 逻辑匹配）',
          limit: '返回段落数量限制，默认 20',
          year: '指定年份筛选段落，如 2024',
          month: '指定月份筛选段落（1-12），需配合 year 使用',
          day: '指定日期筛选段落（1-31），需配合 year 和 month 使用',
          start_time: '开始时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 14:00"',
          end_time: '结束时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 18:30"',
        },
      },
      get_segment_messages: {
        desc: '获取指定段落的完整消息列表。用于在 search_segments 找到相关段落后，获取该段落的完整上下文。返回段落的所有消息及参与者信息。',
        params: {
          segment_id: '段落 ID，可以从 search_segments 的返回结果中获取',
          limit: '返回消息数量限制，默认 1000。对于超长段落可以限制返回数量以节省 token',
        },
      },
      get_segment_summaries: {
        desc: `获取段落摘要列表，快速了解群聊历史讨论的主题。

适用场景：
1. 了解群里最近在聊什么话题
2. 按关键词搜索讨论过的话题
3. 概览性问题如"群里有没有讨论过旅游"

返回的摘要是对每个段落的简短总结，可以帮助快速定位感兴趣的段落，然后用 get_segment_messages 获取详情。`,
        params: {
          keywords: '在摘要中搜索的关键词列表（OR 逻辑匹配）',
          limit: '返回段落数量限制，默认 20',
          year: '指定年份筛选段落',
          month: '指定月份筛选段落（1-12）',
          day: '指定日期筛选段落（1-31）',
          start_time: '开始时间，格式 "YYYY-MM-DD HH:mm"',
          end_time: '结束时间，格式 "YYYY-MM-DD HH:mm"',
        },
      },
      message_type_breakdown: {
        desc: '按消息类型统计近 N 天的消息分布（文本、图片、语音、表情等各有多少条）。适用于了解沟通方式偏好。',
        params: { days: '统计最近多少天的数据' },
        rowTemplate: '{type_name}：{msg_count} 条（占 {percentage}%）',
        summaryTemplate: '消息类型分布（共 {rowCount} 种类型）：',
        fallback: '该时间范围内没有消息记录',
      },
      peak_chat_hours_by_member: {
        desc: '分析指定成员近 N 天的小时分布，找出其最活跃的时间段。需要先获取 member_id。',
        params: {
          member_id: '成员 ID（通过 get_members 获取）',
          days: '统计最近多少天的数据',
        },
        rowTemplate: '{hour}:00 — {msg_count} 条消息',
        summaryTemplate: '该成员各时间段发言量（共 {rowCount} 个活跃时段）：',
        fallback: '指定时间范围内该成员无发言记录',
      },
      member_activity_trend: {
        desc: '查看指定成员近 N 天每天的发言量趋势，观察其活跃度变化。需要先获取 member_id。',
        params: {
          member_id: '成员 ID（通过 get_members 获取）',
          days: '查看最近多少天',
        },
        rowTemplate: '{day}：{msg_count} 条消息',
        summaryTemplate: '该成员近 {rowCount} 天有发言记录：',
        fallback: '指定时间范围内该成员无发言记录',
      },
      silent_members: {
        desc: '检测超过 N 天未发言的"沉默成员"，适用于社群运营中识别流失风险用户。',
        params: { days: '多少天未发言算沉默' },
        rowTemplate: '{name} — 已沉默 {silent_days} 天',
        summaryTemplate: '共发现 {rowCount} 位沉默成员：',
        fallback: '没有找到超过指定天数未发言的成员，社群活跃度良好！',
      },
      reply_interaction_ranking: {
        desc: '分析群内回复互动排名——谁回复谁最多。适用于发现核心互动关系和意见领袖。',
        params: {
          days: '统计最近多少天的数据',
          limit: '返回前多少对互动关系',
        },
        rowTemplate: '{replier_name} → {original_name}：回复 {reply_count} 次',
        summaryTemplate: '回复互动 Top {rowCount}：',
        fallback: '该时间范围内没有回复互动记录',
      },
      mutual_interaction_pairs: {
        desc: '发现互动最频繁的成员组合，基于双向消息时间相邻度（一方发言后5分钟内另一方也发言则记一次互动）。适用于发现亲密好友组合。',
        params: {
          days: '统计最近多少天的数据',
          limit: '返回前多少对',
        },
        rowTemplate: '{member_a} ↔ {member_b}：{interaction_count} 次互动',
        summaryTemplate: '互动最频繁的 {rowCount} 对成员：',
        fallback: '该时间范围内没有明显的互动关系',
      },
      member_message_length_stats: {
        desc: '分析各成员的平均消息长度（仅统计文本消息），消息越长通常代表交流越深入。适用于发现深度交流者。',
        params: {
          days: '统计最近多少天的数据',
          top_n: '返回前多少名',
        },
        rowTemplate: '{name} — 平均 {avg_length} 字/条（共 {msg_count} 条，最长 {max_length} 字）',
        summaryTemplate: '消息长度 Top {rowCount}（越长越深入）：',
        fallback: '该时间范围内没有足够的文本消息数据',
      },
      unanswered_messages: {
        desc: '查找近 N 天内未被回复的消息，这些可能是未解决的客户问题。仅统计文本消息且内容超过 10 字的（过滤简短寒暄）。',
        params: {
          days: '查找最近多少天的数据',
          limit: '最多返回多少条',
        },
        rowTemplate: '[{send_time}] {sender_name}：{content_preview}',
        summaryTemplate: '共发现 {rowCount} 条可能未被回复的消息：',
        fallback: '该时间范围内所有消息都已得到回复，服务质量很好！',
      },
      daily_active_members: {
        desc: '统计每日独立发言人数（DAU）和消息量，用于观察群活力变化趋势。适用于"群活跃度趋势怎么样"、"最近有多少人在说话"。',
        params: { days: '统计最近多少天的数据' },
        rowTemplate: '{day}：{active_members} 人活跃，{msg_count} 条消息',
        summaryTemplate: '近 {rowCount} 天的每日活跃人数趋势：',
        fallback: '该时间范围内没有消息记录',
      },
      conversation_initiator_stats: {
        desc: '统计每个成员发起段落（作为段落首条消息的发送者）的次数，找出谁最常开启话题。需要已生成段落索引。',
        params: {
          days: '统计最近多少天的数据',
          limit: '返回前多少名',
        },
        rowTemplate: '{name}：发起 {initiated_count} 次话题',
        summaryTemplate: '话题发起者 Top {rowCount}：',
        fallback: '该时间范围内没有段落记录，可能需要先生成段落索引',
      },
      activity_heatmap: {
        desc: '返回 星期×小时 的消息数矩阵，适合生成活跃度热力图。weekday: 0=周日, 1=周一, ..., 6=周六。',
        params: { days: '统计最近多少天的数据' },
        rowTemplate: '星期{weekday} {hour}:00 — {msg_count} 条',
        summaryTemplate: '活跃度热力图数据（共 {rowCount} 个时段有消息）：',
        fallback: '该时间范围内没有消息记录',
      },
      response_time_analysis: {
        desc: '分析消息之间的响应时间，按成员维度统计中位数和平均回复速度。适用于"大家平均多久回复消息"、"谁回复最快"。',
        params: {
          days: '统计最近多少天的数据',
          top_n: '返回前多少名',
        },
      },
      keyword_frequency: {
        desc: '对指定时间段的文本消息进行分词，统计高频关键词排行。支持中英日文分词。适用于"大家最常说什么"、"高频关键词是什么"。',
        params: {
          days: '统计最近多少天的数据',
          top_n: '返回前多少个关键词',
        },
      },
      get_schema: {
        desc: '查看聊天数据库表结构。绘图或自定义 SQL 前应先用它确认表名和字段名。',
        params: {},
      },
      render_chart: {
        desc: '根据 ChartSpec v1 生成 ChatLab 原生图表。支持 bar、line、pie、heatmap。提供 `rows`（来自高层工具的数据数组，如 get_time_stats 的 `data` 字段）或 `sql`（只读 SELECT）二选一；有现成数据时优先用 `rows`，只有高层工具无法满足时才写 `sql`。禁止输出 HTML、JavaScript、SVG、ECharts option 或渲染代码。',
        params: {
          rows: '来自高层工具返回的数据数组（如 get_time_stats 的 `data` 字段）。有现成数据时优先使用，与 sql 二选一。',
          sql: '只读 SELECT 或 WITH SELECT SQL。仅在高层工具无法满足需求时使用，必须返回 ChartSpec encoding 中引用的字段。',
          params: 'SQL 命名参数对象；不需要参数时传空对象。',
          chartSpec: 'ChartSpec v1，包含 version、type、title、encoding。',
          maxRows: '图表查询最大行数，默认 1000。',
        },
      },
    },

    agent: {
      answerWithoutTools: '请根据已获取的信息给出回答，不要再调用工具。',
      toolError: '错误: {{error}}',
      currentDateIs: '当前日期是',
      chatContext: {
        private: '对话',
        group: '群聊',
      },
      ownerNote: `当前用户身份：
- 用户在{{chatContext}}中的身份是「{{displayName}}」（platformId: {{platformId}}）
- 当用户提到"我"、"我的"时，指的就是「{{displayName}}」
- 查询"我"的发言时，使用 sender_id 参数筛选该成员
`,
      memberNotePrivate: `成员查询策略：
- 私聊只有两个人，可以直接获取成员列表
- 当用户提到"对方"、"他/她"时，通过 get_members 获取另一方信息
`,
      memberNoteGroup: `成员查询策略：
- 当用户提到特定群成员（如"张三说过什么"、"小明的发言"等）时，应先调用 get_members 获取成员列表
- 群成员有三种名称：accountName（原始昵称）、groupNickname（群昵称）、aliases（用户自定义别名）
- 通过 get_members 的 search 参数可以模糊搜索这三种名称
- 找到成员后，使用其 id 字段作为 search_messages 的 sender_id 参数来获取该成员的发言
`,
      mentionedMembersNote: '本轮用户显式 @ 的成员（可直接使用 member_id，无需再次搜索）：',
      timeParamsIntro: '时间参数：使用 start_time/end_time 指定时间范围，格式 "YYYY-MM-DD HH:mm"',
      defaultYearNote: '未指定时间范围时默认查询全部。当前年份为{{year}}年',
      dataSnapshotNote:
        '当前聊天数据库快照：{{name}}（{{platform}}），总消息 {{totalMessages}} 条，成员 {{totalMembers}} 人，时间范围 {{firstMessageDate}} ~ {{lastMessageDate}}。该快照只用于判断数据范围；回答具体聊天事实仍必须调用工具检索当前数据库。',
      dataSnapshotContext: `当前聊天数据库启动上下文：
- name: {{name}}
- platform: {{platform}}
- type: {{type}}
- total_messages: {{totalMessages}}
- total_members: {{totalMembers}}
- first_message_ts: {{firstMessageTs}}
- first_message_time: {{firstMessageTime}}
- last_message_ts: {{lastMessageTs}}
- last_message_time: {{lastMessageTime}}
- segment_summaries_available: {{segmentSummaryCount}}

{{memberHintTitle}}
{{memberHintLines}}

使用规则：
{{usageRules}}`,
      dataSnapshotMemberHintsAll: '活跃成员查询提示（全部成员）：',
      dataSnapshotMemberHintsTop: '活跃成员查询提示（按历史总消息量 Top 10）：',
      dataSnapshotMemberHintsUnavailable: '活跃成员查询提示：',
      dataSnapshotMemberHintsEmpty: '无可用成员提示。',
      dataSnapshotUsageRules: `- member_id 是工具查询提示；display_name 仅用于人类识别，可能不唯一。
- 不要在最终回答中主动暴露 member_id 或启动上下文本身，除非用户明确要求技术细节。
- 活跃成员排行只代表历史总消息量，不代表最近活跃情况；也不足以作为影响力、关系或近期趋势结论的证据。
- 相对时间表达以真实当前日期为基准，而不是数据库最后消息时间。
- “最近一年/过去一年”表示从真实当前日期回推一年到今天；“去年”表示上一自然年。
- 数据库时间边界只用于说明覆盖范围，不用于重定义用户要求的时间范围。
- 使用默认“近 N 天”的工具时，先选择与数据库时间边界有交集的范围，不要先探测真实当前日期窗口导致空结果。
- 不要只为了重新发现 min/max timestamp 调用工具；但回答具体聊天事实、统计和结论仍必须调用工具获取证据。`,
      evidencePolicy: `证据策略：
- AI 对话历史、历史 AI 回复和压缩摘要只用于理解用户意图，不能作为聊天记录事实证据。
- 只要用户询问聊天记录内容、最近聊什么、某人说过什么、统计排行、是否出现过某话题或要求引用原话，必须先调用合适的数据工具检索当前数据库。
- 如果已追加新聊天记录，当前数据库可能不同于旧窗口历史；优先使用 get_chat_overview 或 get_recent_messages/search_messages 获取最新证据。
- 只有工具返回的消息、统计或数据库概览可以作为事实依据；工具没有返回足够证据时，明确说明数据不足，不要编造不存在的聊天记录。`,
      currentTask: '当前任务',
      skillPriorityNote: '注意：在执行此任务时，请优先遵循以下任务的输出格式要求，这可以覆盖你的常规回复习惯。',
      responseInstruction: '根据用户的问题，选择合适的工具获取数据，然后基于数据给出回答。',
      fallbackRoleDefinition: {
        group: `你是一个专业但风格轻松的群聊记录分析助手。
你的任务是帮助用户理解和分析他们的群聊记录数据，同时可以适度使用 B 站/网络热梗和表情/颜文字活跃气氛，但不影响结论的准确性。

## 回答要求
1. 基于工具返回的数据回答，不要编造信息
2. 如果数据不足以回答问题，请说明
3. 回答要简洁明了，使用 Markdown 格式
4. 可以适度加入 B 站/网络热梗、表情/颜文字（强度适中）
5. 玩梗不得影响事实准确与结论清晰，避免低俗或冒犯性表达`,
        private: `你是一个专业但风格轻松的私聊记录分析助手。
你的任务是帮助用户理解和分析他们的私聊记录数据，同时可以适度使用 B 站/网络热梗和表情/颜文字活跃气氛，但不影响结论的准确性。

## 回答要求
1. 基于工具返回的数据回答，不要编造信息
2. 如果数据不足以回答问题，请说明
3. 回答要简洁明了，使用 Markdown 格式
4. 可以适度加入 B 站/网络热梗、表情/颜文字（强度适中）
5. 玩梗不得影响事实准确与结论清晰，避免低俗或冒犯性表达`,
      },
    },
  },

  llm: {
    notConfigured: 'LLM 服务未配置，请先在设置中配置 API Key',
    maxConfigs: '最多只能添加 {{count}} 个配置',
    configNotFound: '配置不存在',
    noActiveConfig: '没有激活的配置',
    callFailed: 'LLM 调用失败，请检查模型配置是否正确',
    genericProviderName: 'API 服务',
    rawErrorLabel: '原始错误',
  },

  summary: {
    segmentNotFound: '段落不存在或数据库打开失败',
    tooFewMessages: '消息数量少于{{count}}条，无需生成摘要',
    tooFewValidMessages: '有效消息数量少于{{count}}条，无需生成摘要',
    segmentNotExist: '段落不存在',
    messagesTooFew: '消息太少',
    validMessagesTooFew: '有效消息太少',
    systemPromptDirect: '你是一个对话摘要专家，擅长用简洁的语言总结对话内容。',
    systemPromptMerge: '你是一个对话摘要专家，擅长将多个摘要合并成一个连贯的总结。',
  },
}
