/**
 * @openchatlab/tools
 *
 * ChatLab AI 工具链。
 * 提供平台无关的工具定义和 handler，服务于 MCP Server、HTTP API 和 Electron Agent。
 */

// === Registry ===
export { MCP_TOOL_REGISTRY, AGENT_TOOL_REGISTRY, getToolByName } from './registry'

// === Providers ===
export { CoreDataProvider } from './providers/core-data-provider'

// === Tool Definitions ===
export { memberStatsTool } from './definitions/member-stats'
export { timeStatsTool } from './definitions/time-stats'

export { recentMessagesTool } from './definitions/recent-messages'
export { sqlQueryTool, schemaTool } from './definitions/sql-query'
export { chatOverviewTool } from './definitions/chat-overview'
export { searchMessagesTool } from './definitions/search-messages'
export { deepSearchMessagesTool } from './definitions/deep-search-messages'
export { getMessageContextTool } from './definitions/get-message-context'
export { searchSessionsTool } from './definitions/search-sessions'
export { getSessionMessagesTool } from './definitions/get-session-messages'
export { getMembersTool } from './definitions/get-members'
export { getMemberNameHistoryTool } from './definitions/get-member-name-history'
export { getConversationBetweenTool } from './definitions/get-conversation-between'
export { getSessionSummariesTool } from './definitions/get-session-summaries'
export { responseTimeAnalysisTool } from './definitions/response-time-analysis'
export { keywordFrequencyTool } from './definitions/keyword-frequency'
export { renderChartTool } from './definitions/render-chart'

// === SQL Tools ===
export { SQL_TOOL_DEFS, createSqlToolDefinition, createAllSqlToolDefinitions } from './sql'

// === Utils ===
export { isChineseLocale, t, formatTimeRange, formatMessageCompact } from './utils/format'
export { parseExtendedTimeParams } from './utils/time-params'

// === Types ===
export type {
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
  JsonSchema,
  RawMessage,
  ToolDataProvider,
  SearchMessagesResult,
  MemberStatItem,
  SchemaTableInfo,
  TimeFilter,
  ToolCategory,
  TruncationStrategy,
  ChatOverviewResult,
  MemberInfo,
  NameHistoryItem,
  SessionSearchResult,
  SessionMessagesResult,
  ConversationResult,
  SessionSummaryItem,
  SqlToolDef,
  SqlToolExecution,
  SegmentResult,
} from './types'
