/**
 * 主进程中文翻译
 */
export default {
  // ===== 通用 =====
  common: {
    error: '错误',
  },

  // ===== P0: 更新弹窗 =====
  update: {
    newVersionTitle: '发现新版本 v{{version}}',
    newVersionMessage: '发现新版本 v{{version}}',
    newVersionDetail: '是否立即下载并安装新版本？',
    downloadNow: '立即下载',
    cancel: '取消',
    downloadComplete: '下载完成',
    readyToInstall: '新版本已准备就绪，是否现在安装？',
    install: '安装',
    remindLater: '之后提醒',
    installOnQuit: '稍后（应用退出后自动安装）',
    upToDate: '已是最新版本',
  },

  // ===== P0: 文件/目录对话框 =====
  dialog: {
    selectChatFile: '选择聊天记录文件',
    chatRecords: '聊天记录',
    allFiles: '所有文件',
    import: '导入',
    selectDirectory: '选择目录',
    selectFolder: '选择文件夹',
    selectFolderError: '选择文件夹时发生错误：',
  },

  // ===== P1: 数据库迁移 =====
  database: {
    migrationV1Desc: '添加 owner_id 字段到 meta 表',
    migrationV1Message: '支持「Owner」功能，可在成员列表中设置自己的身份',
    migrationV2Desc: '添加 roles、reply_to_message_id、platform_message_id 字段',
    migrationV2Message: '支持成员角色、消息回复关系和回复内容预览',
    migrationV3Desc: '添加会话索引相关表（chat_session、message_context）和 session_gap_threshold 字段',
    migrationV3Message: '支持会话时间轴浏览和 AI 增强分析功能',
    integrityError: '数据库结构不完整：缺少 meta 表。建议删除此数据库文件后重新导入。',
    checkFailed: '数据库检查失败: {{error}}',
  },

  // ===== 工具系统 =====
  tools: {
    notRegistered: '工具 "{{toolName}}" 未注册',
  },

  // ===== P2: AI 工具描述（Function Calling） =====
  ai: {
    tools: {
      search_messages: {
        desc: '根据关键词搜索群聊记录。适用于用户想要查找特定话题、关键词相关的聊天内容。可以指定时间范围和发送者来筛选消息。支持精确到分钟级别的时间查询。',
        params: {
          keywords: '搜索关键词列表，会用 OR 逻辑匹配包含任一关键词的消息。如果只需要按发送者筛选，可以传空数组 []',
          sender_id: '发送者的成员 ID，用于筛选特定成员发送的消息。可以通过 get_members 工具获取成员 ID',
          limit: '返回消息数量限制，默认 1000，最大 50000',
          year: '筛选指定年份的消息，如 2024',
          month: '筛选指定月份的消息（1-12），需要配合 year 使用',
          day: '筛选指定日期的消息（1-31），需要配合 year 和 month 使用',
          hour: '筛选指定小时的消息（0-23），需要配合 year、month 和 day 使用',
          start_time: '开始时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 14:00"。指定后会覆盖 year/month/day/hour 参数',
          end_time: '结束时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 18:30"。指定后会覆盖 year/month/day/hour 参数',
        },
      },
      get_recent_messages: {
        desc: '获取指定时间段内的群聊消息。适用于回答"最近大家聊了什么"、"X月群里聊了什么"等概览性问题。支持精确到分钟级别的时间查询。',
        params: {
          limit: '返回消息数量限制，默认 100（节省 token，可根据需要增加）',
          year: '筛选指定年份的消息，如 2024',
          month: '筛选指定月份的消息（1-12），需要配合 year 使用',
          day: '筛选指定日期的消息（1-31），需要配合 year 和 month 使用',
          hour: '筛选指定小时的消息（0-23），需要配合 year、month 和 day 使用',
          start_time: '开始时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 14:00"。指定后会覆盖 year/month/day/hour 参数',
          end_time: '结束时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 18:30"。指定后会覆盖 year/month/day/hour 参数',
        },
      },
      get_member_stats: {
        desc: '获取群成员的活跃度统计数据。适用于回答"谁最活跃"、"发言最多的是谁"等问题。',
        params: {
          top_n: '返回前 N 名成员，默认 10',
        },
      },
      get_time_stats: {
        desc: '获取群聊的时间分布统计。适用于回答"什么时候最活跃"、"大家一般几点聊天"等问题。',
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
          year: '筛选指定年份的消息',
          month: '筛选指定月份的消息（1-12），需要配合 year 使用',
          day: '筛选指定日期的消息（1-31），需要配合 year 和 month 使用',
          hour: '筛选指定小时的消息（0-23），需要配合 year、month 和 day 使用',
          start_time: '开始时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 14:00"。指定后会覆盖 year/month/day/hour 参数',
          end_time: '结束时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 18:30"。指定后会覆盖 year/month/day/hour 参数',
        },
      },
      get_message_context: {
        desc: '根据消息 ID 获取前后的上下文消息。适用于需要查看某条消息前后聊天内容的场景，比如"这条消息的前后在聊什么"、"查看某条消息的上下文"等。支持单个或批量消息 ID。',
        params: {
          message_ids:
            '要查询上下文的消息 ID 列表，可以是单个 ID 或多个 ID。消息 ID 可以从 search_messages 等工具的返回结果中获取',
          context_size: '上下文大小，即获取前后各多少条消息，默认 20',
        },
      },
      search_sessions: {
        desc: '搜索聊天会话（对话段落）。会话是根据消息时间间隔自动切分的对话单元。适用于查找特定话题的讨论、了解某个时间段内发生了几次对话等场景。返回匹配的会话列表及每个会话的前5条消息预览。',
        params: {
          keywords: '可选的搜索关键词列表，只返回包含这些关键词的会话（OR 逻辑匹配）',
          limit: '返回会话数量限制，默认 20',
          year: '筛选指定年份的会话，如 2024',
          month: '筛选指定月份的会话（1-12），需要配合 year 使用',
          day: '筛选指定日期的会话（1-31），需要配合 year 和 month 使用',
          start_time: '开始时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 14:00"',
          end_time: '结束时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 18:30"',
        },
      },
      get_session_messages: {
        desc: '获取指定会话的完整消息列表。用于在 search_sessions 找到相关会话后，获取该会话的完整上下文。返回会话的所有消息及参与者信息。',
        params: {
          session_id: '会话 ID，可以从 search_sessions 的返回结果中获取',
          limit: '返回消息数量限制，默认 1000。对于超长会话可以限制返回数量以节省 token',
        },
      },
      get_session_summaries: {
        desc: `获取会话摘要列表，快速了解群聊历史讨论的主题。

适用场景：
1. 了解群里最近在聊什么话题
2. 按关键词搜索讨论过的话题
3. 概览性问题如"群里有没有讨论过旅游"

返回的摘要是对每个会话的简短总结，可以帮助快速定位感兴趣的会话，然后用 get_session_messages 获取详情。`,
        params: {
          keywords: '在摘要中搜索的关键词列表（OR 逻辑匹配）',
          limit: '返回会话数量限制，默认 20',
          year: '筛选指定年份的会话',
          month: '筛选指定月份的会话（1-12）',
          day: '筛选指定日期的会话（1-31）',
          start_time: '开始时间，格式 "YYYY-MM-DD HH:mm"',
          end_time: '结束时间，格式 "YYYY-MM-DD HH:mm"',
        },
      },
      // ===== SQL 分析工具 =====
      message_type_breakdown: {
        desc: '按消息类型统计近 N 天的消息分布（文本、图片、语音、表情等各有多少条）。适用于了解沟通方式偏好。',
        params: { days: '统计最近多少天的数据' },
        rowTemplate: '{type_name}：{msg_count} 条（占 {percentage}%）',
        summaryTemplate: '消息类型分布（共 {rowCount} 种类型）：',
        fallback: '该时间范围内没有消息记录',
      },
      peak_chat_hours_by_member: {
        desc: '分析指定成员在近 N 天内每小时的发言量分布，找出其最活跃的时段。需要先通过 get_members 获取 member_id。',
        params: {
          member_id: '成员 ID（通过 get_members 获取）',
          days: '统计最近多少天的数据',
        },
        rowTemplate: '{hour}:00 — {msg_count} 条消息',
        summaryTemplate: '该成员各时段发言量（共 {rowCount} 个活跃时段）：',
        fallback: '该成员在指定时间范围内没有发言记录',
      },
      member_activity_trend: {
        desc: '查看指定成员近 N 天的每日发言数量变化趋势。适用于观察某人是否变得更活跃或更沉默。需要先通过 get_members 获取 member_id。',
        params: {
          member_id: '成员 ID（通过 get_members 获取）',
          days: '查看最近多少天的趋势',
        },
        rowTemplate: '{day}：{msg_count} 条',
        summaryTemplate: '该成员近 {rowCount} 天有发言记录：',
        fallback: '该成员在指定时间范围内没有发言记录',
      },
      silent_members: {
        desc: '检测超过 N 天未发言的「沉默成员」。适用于社群运营中发现流失风险用户。',
        params: { days: '多少天未发言算沉默' },
        rowTemplate: '{name} — 已沉默 {silent_days} 天',
        summaryTemplate: '共发现 {rowCount} 位沉默成员：',
        fallback: '没有发现超过指定天数未发言的成员，社群活跃度良好！',
      },
      reply_interaction_ranking: {
        desc: '分析群内的回复互动关系排行，找出谁回复谁最多。适用于发现社群中的核心互动关系和意见领袖。',
        params: {
          days: '统计最近多少天的数据',
          limit: '返回前多少对互动关系',
        },
        rowTemplate: '{replier_name} → {original_name}：{reply_count} 次回复',
        summaryTemplate: '回复互动 Top {rowCount}：',
        fallback: '该时间范围内没有回复互动记录',
      },
      mutual_interaction_pairs: {
        desc: '找出互动最频繁的成员对，基于双向消息时间接近度（一方发言后 5 分钟内另一方也发言即视为一次互动）。适用于发现关系亲密的好友组合。',
        params: {
          days: '统计最近多少天的数据',
          limit: '返回前多少对',
        },
        rowTemplate: '{member_a} ↔ {member_b}：{interaction_count} 次互动',
        summaryTemplate: '互动最频繁的 {rowCount} 对好友：',
        fallback: '该时间范围内没有检测到明显的互动关系',
      },
      member_message_length_stats: {
        desc: '统计各成员的平均消息长度（仅文本消息），长消息通常意味着更用心的交流。适用于发现深度交流者。',
        params: {
          days: '统计最近多少天的数据',
          top_n: '返回前多少名',
        },
        rowTemplate: '{name} — 平均 {avg_length} 字/条（共 {msg_count} 条，最长 {max_length} 字）',
        summaryTemplate: '消息长度 Top {rowCount}（更长 = 更用心）：',
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
    },

    // ===== AI Agent 系统提示词 =====
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
      timeParamsIntro: '时间参数：按用户提到的精度组合 year/month/day/hour',
      timeParamExample1: '"10月" → year: {{year}}, month: 10',
      timeParamExample2: '"10月1号" → year: {{year}}, month: 10, day: 1',
      timeParamExample3: '"10月1号下午3点" → year: {{year}}, month: 10, day: 1, hour: 15',
      defaultYearNote: '未指定年份默认{{year}}年，若该月份未到则用{{prevYear}}年',
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

  // ===== P3: LLM 配置 =====
  llm: {
    notConfigured: 'LLM 服务未配置，请先在设置中配置 API Key',
    maxConfigs: '最多只能添加 {{count}} 个配置',
    configNotFound: '配置不存在',
    noActiveConfig: '没有激活的配置',
    callFailed: 'LLM 调用失败，请检查模型配置是否正确',
  },

  // ===== P4: 摘要生成 =====
  summary: {
    sessionNotFound: '会话不存在或数据库打开失败',
    tooFewMessages: '消息数量少于{{count}}条，无需生成摘要',
    tooFewValidMessages: '有效消息数量少于{{count}}条，无需生成摘要',
    sessionNotExist: '会话不存在',
    messagesTooFew: '消息太少',
    validMessagesTooFew: '有效消息太少',
    systemPromptDirect: '你是一个对话摘要专家，擅长用简洁的语言总结对话内容。',
    systemPromptMerge: '你是一个对话摘要专家，擅长将多个摘要合并成一个连贯的总结。',
  },
}
