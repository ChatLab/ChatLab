/**
 * 内置工具目录（静态数据）
 *
 * 仅包含工具名称和分类，不含任何运行时依赖。
 * 用于前端展示工具列表和助手配置面板。
 */

export type ToolCategory = 'core' | 'analysis'

export interface BuiltinToolCatalogEntry {
  name: string
  category: ToolCategory
}

export const BUILTIN_TOOL_CATALOG: BuiltinToolCatalogEntry[] = [
  // Core 工具
  { name: 'get_chat_overview', category: 'core' },
  { name: 'search_messages', category: 'core' },
  { name: 'deep_search_messages', category: 'core' },
  { name: 'get_recent_messages', category: 'core' },
  { name: 'get_message_context', category: 'core' },
  { name: 'search_segments', category: 'core' },
  { name: 'get_segment_messages', category: 'core' },
  { name: 'get_members', category: 'core' },
  { name: 'get_schema', category: 'core' },

  // Analysis 工具
  { name: 'get_member_stats', category: 'analysis' },
  { name: 'get_time_stats', category: 'analysis' },
  { name: 'get_member_name_history', category: 'analysis' },
  { name: 'get_conversation_between', category: 'analysis' },
  { name: 'get_segment_summaries', category: 'analysis' },
  { name: 'response_time_analysis', category: 'analysis' },
  { name: 'keyword_frequency', category: 'analysis' },
  { name: 'render_chart', category: 'analysis' },
  { name: 'execute_sql', category: 'analysis' },

  // SQL Analysis 工具
  { name: 'message_type_breakdown', category: 'analysis' },
  { name: 'peak_chat_hours_by_member', category: 'analysis' },
  { name: 'member_activity_trend', category: 'analysis' },
  { name: 'silent_members', category: 'analysis' },
  { name: 'reply_interaction_ranking', category: 'analysis' },
  { name: 'mutual_interaction_pairs', category: 'analysis' },
  { name: 'member_message_length_stats', category: 'analysis' },
  { name: 'daily_active_members', category: 'analysis' },
  { name: 'conversation_initiator_stats', category: 'analysis' },
  { name: 'activity_heatmap', category: 'analysis' },
  { name: 'unanswered_messages', category: 'analysis' },
]
