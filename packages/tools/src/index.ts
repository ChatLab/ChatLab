/**
 * @openchatlab/tools
 *
 * ChatLab AI 工具链。
 * 提供平台无关的工具定义和 handler，服务于 MCP Server、HTTP API 和 Electron Agent。
 */

// === Registry ===
export {
  MCP_TOOL_REGISTRY,
  AGENT_TOOL_REGISTRY,
  SEMANTIC_SEARCH_TOOL_NAME,
  RETRIEVE_CHAT_EVIDENCE_TOOL_NAME,
  getToolByName,
} from './registry'

// === Providers ===
export { CoreDataProvider } from './providers/core-data-provider'

// === Agent Adapter ===
export { executeToolForAgent, toAgentToolParameters } from './agent-adapter'

// === Tool Definitions ===
export { memberStatsTool } from './definitions/member-stats'
export { timeStatsTool } from './definitions/time-stats'

export { recentMessagesTool } from './definitions/recent-messages'
export { sqlQueryTool, schemaTool } from './definitions/sql-query'
export { chatOverviewTool } from './definitions/chat-overview'
export { searchMessagesTool } from './definitions/search-messages'
export { deepSearchMessagesTool } from './definitions/deep-search-messages'
export { getMessageContextTool } from './definitions/get-message-context'
export { getSegmentMessagesTool } from './definitions/get-segment-messages'
export { getMembersTool } from './definitions/get-members'
export { getMemberNameHistoryTool } from './definitions/get-member-name-history'
export { getConversationBetweenTool } from './definitions/get-conversation-between'
export { getSegmentSummariesTool } from './definitions/get-segment-summaries'
export { responseTimeAnalysisTool } from './definitions/response-time-analysis'
export { keywordFrequencyTool } from './definitions/keyword-frequency'
export { renderChartTool } from './definitions/render-chart'
export { semanticSearchCurrentChatTool } from './definitions/semantic-search-current-chat'
export { retrieveChatEvidenceTool } from './definitions/retrieve-chat-evidence'

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
  ToolTimeRange,
  ToolCategory,
  TruncationStrategy,
  ChatOverviewResult,
  MemberInfo,
  NameHistoryItem,
  SegmentMessagesResult,
  ConversationResult,
  SegmentSummaryItem,
  SqlToolDef,
  SqlToolExecution,
  SegmentResult,
  SemanticSearchToolService,
  SemanticSearchToolResult,
  SemanticSearchToolSource,
  SemanticSearchToolOptions,
  ChatEvidencePayload,
  ChatEvidenceGroup,
  ChatEvidenceSource,
  EvidenceStatus,
  EvidencePayloadStatus,
  EvidenceRetrievalMode,
  EvidenceWarning,
  EvidenceTimeRangeMs,
} from './types'

export { SEMANTIC_SEARCH_DEFAULT_MAX_RESULTS, SEMANTIC_SEARCH_MAX_RESULTS_HARD_CAP } from './types'
