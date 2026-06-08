export type RequestRoute = 'direct_response' | 'tool_assisted' | 'planned_execution'

export type EvaluationScenario =
  | 'casual_chat'
  | 'concept_explanation'
  | 'help_or_configuration'
  | 'simple_data_query'
  | 'simple_search'
  | 'long_range_trend_analysis'
  | 'key_member_influence'
  | 'relationship_analysis'
  | 'topic_evolution'
  | 'search_failure_recovery'
  | 'multi_condition_filter'
  | 'member_lookup_then_messages'
  | 'insufficient_evidence'

export interface RouteEvaluationCase {
  id: string
  locale: 'zh-CN' | 'en-US'
  chatType: 'group' | 'private'
  userMessage: string
  expectedRoute: RequestRoute
  scenarios: EvaluationScenario[]
  expectedEvidenceCoverage: string[]
  baseline: {
    status: 'pending_real_environment_run'
    notes: string
  }
}

export const REQUIRED_EVALUATION_SCENARIOS: readonly EvaluationScenario[] = [
  'casual_chat',
  'concept_explanation',
  'help_or_configuration',
  'simple_data_query',
  'simple_search',
  'long_range_trend_analysis',
  'key_member_influence',
  'relationship_analysis',
  'topic_evolution',
  'search_failure_recovery',
  'multi_condition_filter',
  'member_lookup_then_messages',
  'insufficient_evidence',
]

const pendingBaseline = {
  status: 'pending_real_environment_run',
  notes: 'Requires a configured LLM service and a real or fixture chat database; do not fake baseline results.',
} as const

export const AI_AGENT_ROUTING_EVALUATION_SET: readonly RouteEvaluationCase[] = [
  {
    id: 'ai-route-eval-001',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '你觉得我今天应该先整理资料还是先回复消息？',
    expectedRoute: 'direct_response',
    scenarios: ['casual_chat'],
    expectedEvidenceCoverage: [],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-002',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '解释一下什么是 Function Calling Agent，和 ReACT 有什么区别？',
    expectedRoute: 'direct_response',
    scenarios: ['concept_explanation'],
    expectedEvidenceCoverage: [],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-003',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: 'ChatLab 的 AI 日志在哪里看？',
    expectedRoute: 'direct_response',
    scenarios: ['help_or_configuration'],
    expectedEvidenceCoverage: [],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-004',
    locale: 'zh-CN',
    chatType: 'private',
    userMessage: '不用查聊天记录，帮我把这句话润色得自然一点：明天我可能晚点到。',
    expectedRoute: 'direct_response',
    scenarios: ['casual_chat'],
    expectedEvidenceCoverage: [],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-005',
    locale: 'en-US',
    chatType: 'group',
    userMessage: 'Briefly explain why native function calling is safer than text-formatted actions.',
    expectedRoute: 'direct_response',
    scenarios: ['concept_explanation'],
    expectedEvidenceCoverage: [],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-006',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '帮我看看这个群一共有多少成员、多少条消息。',
    expectedRoute: 'tool_assisted',
    scenarios: ['simple_data_query'],
    expectedEvidenceCoverage: [],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-007',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '昨天大家主要聊了什么？简单概括一下。',
    expectedRoute: 'tool_assisted',
    scenarios: ['simple_search'],
    expectedEvidenceCoverage: [],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-008',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '找一下最近提到“报销”的聊天记录。',
    expectedRoute: 'tool_assisted',
    scenarios: ['simple_search'],
    expectedEvidenceCoverage: [],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-009',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '谁发言最多？给我前 5 名就行。',
    expectedRoute: 'tool_assisted',
    scenarios: ['simple_data_query'],
    expectedEvidenceCoverage: [],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-010',
    locale: 'zh-CN',
    chatType: 'private',
    userMessage: '我和对方上周有没有聊到“面试”？',
    expectedRoute: 'tool_assisted',
    scenarios: ['simple_search'],
    expectedEvidenceCoverage: [],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-011',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '找一下昵称里带“小王”的成员，然后看他最近 20 条发言。',
    expectedRoute: 'tool_assisted',
    scenarios: ['member_lookup_then_messages'],
    expectedEvidenceCoverage: [],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-012',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '这个群今天凌晨 0 点到 6 点有没有异常活跃？',
    expectedRoute: 'tool_assisted',
    scenarios: ['simple_data_query'],
    expectedEvidenceCoverage: [],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-013',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '分析过去一年群里话题的变化趋势，按季度总结主要变化，并举出证据。',
    expectedRoute: 'planned_execution',
    scenarios: ['long_range_trend_analysis', 'topic_evolution'],
    expectedEvidenceCoverage: [
      'Collect representative messages or summaries across at least three quarterly windows.',
      'Compare topic distribution changes over time rather than summarizing one period only.',
      'Cite concrete message examples or retrieved evidence for each major trend.',
    ],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-014',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '找出这个群里影响力最强的 3 个人，并说明他们分别影响了哪些话题或互动。',
    expectedRoute: 'planned_execution',
    scenarios: ['key_member_influence'],
    expectedEvidenceCoverage: [
      'Use member activity or interaction statistics to identify candidates.',
      'Verify each candidate with message examples or conversation context.',
      'Separate message volume from influence and state limitations.',
    ],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-015',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '分析 Alice 和 Bob 最近半年的互动关系：谁更主动、回应是否及时、主要聊什么。',
    expectedRoute: 'planned_execution',
    scenarios: ['relationship_analysis', 'multi_condition_filter'],
    expectedEvidenceCoverage: [
      'Resolve both members before querying their interaction.',
      'Compare initiation, response timing, and topic evidence.',
      'Use a bounded time range and cite representative exchanges.',
    ],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-016',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '复盘今年项目相关讨论：从需求、开发、上线到反馈，每个阶段有哪些关键分歧？',
    expectedRoute: 'planned_execution',
    scenarios: ['long_range_trend_analysis', 'topic_evolution', 'multi_condition_filter'],
    expectedEvidenceCoverage: [
      'Segment the year into meaningful project phases.',
      'Search project-related terms and inspect context around disagreements.',
      'Connect conclusions to cited messages instead of only reporting counts.',
    ],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-017',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '如果直接搜“团建预算”找不到结果，请换几个相关说法继续查，最后告诉我有没有讨论过。',
    expectedRoute: 'planned_execution',
    scenarios: ['search_failure_recovery'],
    expectedEvidenceCoverage: [
      'Try the exact query first and record whether it finds evidence.',
      'Retry with semantically related terms such as activity, reimbursement, cost, or venue.',
      'Distinguish no evidence found from evidence of absence.',
    ],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-018',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '筛选去年 9 月到 12 月里，张三参与、和“考试”相关、并且有人回复的问题，总结主要矛盾。',
    expectedRoute: 'planned_execution',
    scenarios: ['multi_condition_filter', 'member_lookup_then_messages'],
    expectedEvidenceCoverage: [
      'Resolve Zhang San to member identity before filtering messages.',
      'Apply time, topic, participant, and reply/context constraints together.',
      'Summarize only conflicts supported by retrieved conversation context.',
    ],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-019',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '判断大家是不是从 5 月开始明显减少讨论 AI 了；如果证据不够，也请说明不够。',
    expectedRoute: 'planned_execution',
    scenarios: ['long_range_trend_analysis', 'insufficient_evidence'],
    expectedEvidenceCoverage: [
      'Compare AI-related mentions before and after May with consistent criteria.',
      'Check enough date coverage to avoid overfitting a short window.',
      'Explicitly state uncertainty when message volume or query coverage is insufficient.',
    ],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-020',
    locale: 'zh-CN',
    chatType: 'private',
    userMessage: '总结我和对方关系的变化：从刚开始聊天到最近，有哪些明显转折点？',
    expectedRoute: 'planned_execution',
    scenarios: ['relationship_analysis', 'topic_evolution', 'long_range_trend_analysis'],
    expectedEvidenceCoverage: [
      'Sample early, middle, and recent conversation periods.',
      'Identify relationship changes through message context, not only sentiment words.',
      'Cite concrete exchanges for each proposed turning point.',
    ],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-021',
    locale: 'en-US',
    chatType: 'group',
    userMessage: 'Compare the top discussion themes in the first half and second half of the archive, with evidence.',
    expectedRoute: 'planned_execution',
    scenarios: ['long_range_trend_analysis', 'topic_evolution'],
    expectedEvidenceCoverage: [
      'Split the archive into two comparable time windows.',
      'Identify themes with retrieval or statistics in both windows.',
      'Provide evidence for differences and avoid unsupported causal claims.',
    ],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-022',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '这个群里有没有人长期被忽略？请结合发言、回复和互动情况分析。',
    expectedRoute: 'planned_execution',
    scenarios: ['key_member_influence', 'relationship_analysis', 'insufficient_evidence'],
    expectedEvidenceCoverage: [
      'Use interaction or reply statistics to find low-response candidates.',
      'Inspect representative contexts before labeling anyone ignored.',
      'State limitations because absence of replies can be ambiguous.',
    ],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-023',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '最近有没有提过“签证”？如果没有，帮我查查可能相关的“护照”“出行”“材料”。',
    expectedRoute: 'planned_execution',
    scenarios: ['search_failure_recovery', 'simple_search'],
    expectedEvidenceCoverage: [
      'Search the exact keyword before related alternatives.',
      'Inspect related keyword results for actual relevance.',
      'Report whether evidence is direct, indirect, or absent.',
    ],
    baseline: pendingBaseline,
  },
  {
    id: 'ai-route-eval-024',
    locale: 'zh-CN',
    chatType: 'group',
    userMessage: '按月份分析过去一年谁在技术讨论里最活跃，以及他们关注的话题有没有变化。',
    expectedRoute: 'planned_execution',
    scenarios: ['long_range_trend_analysis', 'key_member_influence', 'multi_condition_filter'],
    expectedEvidenceCoverage: [
      'Filter technical discussions consistently across the full year.',
      'Compare monthly member activity rather than only global totals.',
      'Inspect topic evidence for top members across different months.',
    ],
    baseline: pendingBaseline,
  },
]
