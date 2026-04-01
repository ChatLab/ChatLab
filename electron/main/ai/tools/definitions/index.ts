/**
 * 工具定义聚合
 * 收集 definitions/ 下所有工具的 createTool 工厂函数
 */

export { createTool as createSearchMessages } from './search-messages'
export { createTool as createGetRecentMessages } from './get-recent-messages'
export { createTool as createGetMemberStats } from './get-member-stats'
export { createTool as createGetTimeStats } from './get-time-stats'
export { createTool as createGetMembers } from './get-group-members'
export { createTool as createGetMemberNameHistory } from './get-member-name-history'
export { createTool as createGetConversationBetween } from './get-conversation-between'
export { createTool as createGetMessageContext } from './get-message-context'
export { createTool as createSearchSessions } from './search-sessions'
export { createTool as createGetSessionMessages } from './get-session-messages'
export { createTool as createGetSessionSummaries } from './get-session-summaries'
export { createTool as createSemanticSearchMessages } from './semantic-search-messages'
export { sqlToolFactories, getSqlToolCatalog, SQL_TOOL_NAMES } from './sql-analysis'

export const TS_TOOL_NAMES = [
  'search_messages',
  'get_recent_messages',
  'get_member_stats',
  'get_time_stats',
  'get_members',
  'get_member_name_history',
  'get_conversation_between',
  'get_message_context',
  'search_sessions',
  'get_session_messages',
  'get_session_summaries',
  'semantic_search_messages',
]
