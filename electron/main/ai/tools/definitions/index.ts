/**
 * 工具定义聚合 + 统一注册表
 *
 * TOOL_REGISTRY 是全局唯一的工具清单，驱动后端加载和前端目录展示。
 * 新增工具只需在此追加一条 ToolRegistryEntry。
 */

import type { ToolRegistryEntry } from '../types'

import { createTool as createGetChatOverview } from './get-chat-overview'
import { createTool as createSearchMessages } from './search-messages'
import { createTool as createDeepSearchMessages } from './deep-search-messages'
import { createTool as createGetRecentMessages } from './get-recent-messages'
import { createTool as createGetMessageContext } from './get-message-context'
import { createTool as createSearchSessions } from './search-sessions'
import { createTool as createGetSessionMessages } from './get-session-messages'
import { createTool as createGetMembers } from './get-group-members'
import { createTool as createGetMemberStats } from './get-member-stats'
import { createTool as createGetTimeStats } from './get-time-stats'
import { createTool as createGetMemberNameHistory } from './get-member-name-history'
import { createTool as createGetConversationBetween } from './get-conversation-between'
import { createTool as createGetSessionSummaries } from './get-session-summaries'
import { createTool as createResponseTimeAnalysis } from './response-time-analysis'
import { createTool as createKeywordFrequency } from './keyword-frequency'

import { sqlToolEntries } from './sql-analysis'

export { sqlToolEntries } from './sql-analysis'

export const TOOL_REGISTRY: ToolRegistryEntry[] = [
  // ==================== Core 工具（始终加载） ====================
  { name: 'get_chat_overview', factory: createGetChatOverview, category: 'core' },
  { name: 'search_messages', factory: createSearchMessages, category: 'core', truncationStrategy: 'keep_first' },
  {
    name: 'deep_search_messages',
    factory: createDeepSearchMessages,
    category: 'core',
    truncationStrategy: 'keep_first',
  },
  { name: 'get_recent_messages', factory: createGetRecentMessages, category: 'core', truncationStrategy: 'keep_last' },
  { name: 'get_message_context', factory: createGetMessageContext, category: 'core', truncationStrategy: 'keep_last' },
  { name: 'search_sessions', factory: createSearchSessions, category: 'core' },
  {
    name: 'get_session_messages',
    factory: createGetSessionMessages,
    category: 'core',
    truncationStrategy: 'keep_last',
  },
  { name: 'get_members', factory: createGetMembers, category: 'core' },

  // ==================== Analysis 工具（按需加载） ====================
  { name: 'get_member_stats', factory: createGetMemberStats, category: 'analysis' },
  { name: 'get_time_stats', factory: createGetTimeStats, category: 'analysis' },
  { name: 'get_member_name_history', factory: createGetMemberNameHistory, category: 'analysis' },
  {
    name: 'get_conversation_between',
    factory: createGetConversationBetween,
    category: 'analysis',
    truncationStrategy: 'keep_last',
  },
  { name: 'get_session_summaries', factory: createGetSessionSummaries, category: 'analysis' },
  { name: 'response_time_analysis', factory: createResponseTimeAnalysis, category: 'analysis' },
  { name: 'keyword_frequency', factory: createKeywordFrequency, category: 'analysis' },

  // SQL 分析工具
  ...sqlToolEntries,
]
