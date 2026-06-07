/**
 * Tool registries
 *
 * AGENT_TOOL_REGISTRY: full toolset for Server Agent / Electron Agent
 *   (core + analysis + raw SQL + declarative SQL tools).
 * MCP_TOOL_REGISTRY: slim toolset for MCP Server — core + analysis + raw SQL
 *   plus MCP-specific session-discovery tools. Omits declarative SQL tools
 *   to keep tool-schema token cost low for external AI agents.
 */

import type { ToolDefinition } from './types'

import { sqlQueryTool, schemaTool } from './definitions/sql-query'
import { renderChartTool } from './definitions/render-chart'
import { sessionInfoTool } from './definitions/session-info'
import { sessionsListTool } from './definitions/sessions'
import { chatOverviewTool } from './definitions/chat-overview'
import { searchMessagesTool } from './definitions/search-messages'
import { deepSearchMessagesTool } from './definitions/deep-search-messages'
import { getMessageContextTool } from './definitions/get-message-context'
import { searchSegmentsTool } from './definitions/search-segments'
import { getSegmentMessagesTool } from './definitions/get-segment-messages'
import { getMembersTool } from './definitions/get-members'
import { memberStatsTool } from './definitions/member-stats'
import { timeStatsTool } from './definitions/time-stats'
import { recentMessagesTool } from './definitions/recent-messages'
import { getMemberNameHistoryTool } from './definitions/get-member-name-history'
import { getConversationBetweenTool } from './definitions/get-conversation-between'
import { getSegmentSummariesTool } from './definitions/get-segment-summaries'
import { responseTimeAnalysisTool } from './definitions/response-time-analysis'
import { keywordFrequencyTool } from './definitions/keyword-frequency'
import { SQL_TOOL_DEFS, createAllSqlToolDefinitions } from './sql'

/**
 * Core + analysis + raw SQL — shared between Agent and MCP.
 * New non-SQL tools added here will automatically appear in both registries.
 */
const SHARED_TOOLS: ToolDefinition[] = [
  // Core
  chatOverviewTool,
  searchMessagesTool,
  deepSearchMessagesTool,
  recentMessagesTool,
  getMessageContextTool,
  searchSegmentsTool,
  getSegmentMessagesTool,
  getMembersTool,
  schemaTool,

  // Analysis
  memberStatsTool,
  timeStatsTool,
  getMemberNameHistoryTool,
  getConversationBetweenTool,
  getSegmentSummariesTool,
  responseTimeAnalysisTool,
  keywordFrequencyTool,
  renderChartTool,

  // Raw SQL
  sqlQueryTool,
]

/**
 * Agent full toolset (Server Agent / Electron Agent).
 * Includes declarative SQL convenience tools on top of the shared set.
 */
export const AGENT_TOOL_REGISTRY: ToolDefinition[] = [...SHARED_TOOLS, ...createAllSqlToolDefinitions(SQL_TOOL_DEFS)]

/**
 * MCP Server toolset — slim registry optimised for external AI agents.
 *
 * Includes MCP-specific session-discovery tools + shared core/analysis tools.
 * Omits declarative SQL tools to reduce tool-schema token overhead (~40% saving).
 * LLMs can use execute_sql + get_schema for any custom query.
 */
export const MCP_TOOL_REGISTRY: ToolDefinition[] = [
  // MCP-specific: session discovery & schema
  sessionsListTool,
  sessionInfoTool,
  // Shared core + analysis + raw SQL
  ...SHARED_TOOLS,
]

/**
 * 按名称查找工具（在所有注册表中查找）
 */
export function getToolByName(name: string): ToolDefinition | undefined {
  return AGENT_TOOL_REGISTRY.find((t) => t.name === name) || MCP_TOOL_REGISTRY.find((t) => t.name === name)
}
