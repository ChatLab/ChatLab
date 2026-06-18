/**
 * 工具定义聚合 + 统一注册表
 *
 * TOOL_REGISTRY 是全局唯一的工具清单，驱动后端加载和前端目录展示。
 * 所有工具定义来自 @openchatlab/tools 共享包，通过 adaptSharedTool 适配为 Electron AgentTool。
 */

import type { ToolRegistryEntry } from '../types'

import {
  chatOverviewTool,
  searchMessagesTool,
  deepSearchMessagesTool,
  recentMessagesTool,
  getMessageContextTool,
  getSegmentMessagesTool,
  getMembersTool,
  schemaTool,
  sqlQueryTool,
  memberStatsTool,
  timeStatsTool,
  getMemberNameHistoryTool,
  getConversationBetweenTool,
  getSegmentSummariesTool,
  responseTimeAnalysisTool,
  keywordFrequencyTool,
  renderChartTool,
  SQL_TOOL_DEFS,
  createSqlToolDefinition,
} from '@openchatlab/tools'

import { adaptSharedTool } from '../shared-tool-adapter'

// SQL 工具转换为 ToolDefinition 再适配
const sqlToolDefinitions = SQL_TOOL_DEFS.map(createSqlToolDefinition)

export const sqlToolEntries: ToolRegistryEntry[] = sqlToolDefinitions.map((t) =>
  adaptSharedTool(t, { category: 'analysis' })
)

export const SQL_TOOL_NAMES = SQL_TOOL_DEFS.map((d) => d.name)

export const TOOL_REGISTRY: ToolRegistryEntry[] = [
  // ==================== Core 工具（始终加载） ====================
  adaptSharedTool(chatOverviewTool, { category: 'core' }),
  adaptSharedTool(searchMessagesTool, { category: 'core', truncationStrategy: 'keep_first' }),
  adaptSharedTool(deepSearchMessagesTool, { category: 'core', truncationStrategy: 'keep_first' }),
  adaptSharedTool(recentMessagesTool, { category: 'core', truncationStrategy: 'keep_last' }),
  adaptSharedTool(getMessageContextTool, { category: 'core', truncationStrategy: 'keep_last' }),
  adaptSharedTool(getSegmentMessagesTool, { category: 'core', truncationStrategy: 'keep_last' }),
  adaptSharedTool(getMembersTool, { category: 'core' }),
  adaptSharedTool(schemaTool, { category: 'core' }),

  // ==================== Analysis 工具（按需加载） ====================
  adaptSharedTool(memberStatsTool, { category: 'analysis' }),
  adaptSharedTool(timeStatsTool, { category: 'analysis' }),
  adaptSharedTool(getMemberNameHistoryTool, { category: 'analysis' }),
  adaptSharedTool(getConversationBetweenTool, { category: 'analysis', truncationStrategy: 'keep_last' }),
  adaptSharedTool(getSegmentSummariesTool, { category: 'analysis' }),
  adaptSharedTool(responseTimeAnalysisTool, { category: 'analysis' }),
  adaptSharedTool(keywordFrequencyTool, { category: 'analysis' }),
  adaptSharedTool(renderChartTool, { category: 'analysis' }),
  adaptSharedTool(sqlQueryTool, { category: 'analysis' }),

  // ==================== SQL 分析工具 ====================
  ...sqlToolEntries,
]
