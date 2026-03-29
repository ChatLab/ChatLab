/**
 * SQL 分析工具定义集合
 *
 * 声明式 SQL 工具，与 TS 工具遵循相同的工厂函数模式。
 * 每个工具通过 createSqlTool() 将 JSON 定义转化为 AgentTool。
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext, ToolRegistryEntry } from '../types'
import type { CustomSqlToolDef } from '../../assistant/types'
import { createSqlTool } from '../../assistant/sqlToolRunner'
import { t as i18nT } from '../../../i18n'

const SQL_TOOL_DEFS: CustomSqlToolDef[] = [
  // ==================== 通用分析 ====================
  {
    name: 'message_type_breakdown',
    description:
      '按消息类型统计近 N 天的消息分布（文本、图片、语音、表情等各有多少条）。适用于了解沟通方式偏好。',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '统计最近多少天的数据' },
      },
      required: ['days'],
    },
    execution: {
      type: 'sqlite',
      query:
        "SELECT CASE type WHEN 0 THEN '文本' WHEN 1 THEN '图片' WHEN 2 THEN '语音' WHEN 3 THEN '视频' WHEN 4 THEN '文件' WHEN 5 THEN '表情' WHEN 7 THEN '链接' WHEN 20 THEN '红包' WHEN 22 THEN '拍一拍' WHEN 80 THEN '系统消息' WHEN 81 THEN '撤回' ELSE '其他' END AS type_name, COUNT(*) AS msg_count, ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS percentage FROM message WHERE ts > unixepoch('now', '-' || @days || ' days') GROUP BY type ORDER BY msg_count DESC",
      rowTemplate: '{type_name}：{msg_count} 条（占 {percentage}%）',
      summaryTemplate: '消息类型分布（共 {rowCount} 种类型）：',
      fallback: '该时间范围内没有消息记录',
    },
  },
  {
    name: 'peak_chat_hours_by_member',
    description:
      '分析指定成员在近 N 天内每小时的发言量分布，找出其最活跃的时段。需要先通过 get_members 获取 member_id。',
    parameters: {
      type: 'object',
      properties: {
        member_id: { type: 'number', description: '成员 ID（通过 get_members 获取）' },
        days: { type: 'number', description: '统计最近多少天的数据', default: 30 },
      },
      required: ['member_id'],
    },
    execution: {
      type: 'sqlite',
      query:
        "SELECT CAST(strftime('%H', ts, 'unixepoch', 'localtime') AS INTEGER) AS hour, COUNT(*) AS msg_count FROM message WHERE sender_id = @member_id AND ts > unixepoch('now', '-' || @days || ' days') GROUP BY hour ORDER BY msg_count DESC",
      rowTemplate: '{hour}:00 — {msg_count} 条消息',
      summaryTemplate: '该成员各时段发言量（共 {rowCount} 个活跃时段）：',
      fallback: '该成员在指定时间范围内没有发言记录',
    },
  },

  // ==================== 社群分析 ====================
  {
    name: 'member_activity_trend',
    description:
      '查看指定成员近 N 天的每日发言数量变化趋势。适用于观察某人是否变得更活跃或更沉默。需要先通过 get_members 获取 member_id。',
    parameters: {
      type: 'object',
      properties: {
        member_id: { type: 'number', description: '成员 ID（通过 get_members 获取）' },
        days: { type: 'number', description: '查看最近多少天的趋势' },
      },
      required: ['member_id', 'days'],
    },
    execution: {
      type: 'sqlite',
      query:
        "SELECT date(ts, 'unixepoch', 'localtime') AS day, COUNT(*) AS msg_count FROM message WHERE sender_id = @member_id AND ts > unixepoch('now', '-' || @days || ' days') GROUP BY day ORDER BY day",
      rowTemplate: '{day}：{msg_count} 条',
      summaryTemplate: '该成员近 {rowCount} 天有发言记录：',
      fallback: '该成员在指定时间范围内没有发言记录',
    },
  },
  {
    name: 'silent_members',
    description: '检测超过 N 天未发言的「沉默成员」。适用于社群运营中发现流失风险用户。',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '多少天未发言算沉默', default: 7 },
      },
      required: ['days'],
    },
    execution: {
      type: 'sqlite',
      query:
        "SELECT m.id AS member_id, COALESCE(m.group_nickname, m.account_name, m.platform_id) AS name, MAX(msg.ts) AS last_msg_ts, CAST((unixepoch('now') - MAX(msg.ts)) / 86400 AS INTEGER) AS silent_days FROM member m JOIN message msg ON msg.sender_id = m.id GROUP BY m.id HAVING silent_days >= @days ORDER BY silent_days DESC LIMIT 30",
      rowTemplate: '{name} — 已沉默 {silent_days} 天',
      summaryTemplate: '共发现 {rowCount} 位沉默成员：',
      fallback: '没有发现超过指定天数未发言的成员，社群活跃度良好！',
    },
  },
  {
    name: 'reply_interaction_ranking',
    description: '分析群内的回复互动关系排行，找出谁回复谁最多。适用于发现社群中的核心互动关系和意见领袖。',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '统计最近多少天的数据' },
        limit: { type: 'number', description: '返回前多少对互动关系', default: 10 },
      },
      required: ['days'],
    },
    execution: {
      type: 'sqlite',
      query:
        "SELECT COALESCE(replier.group_nickname, replier.account_name) AS replier_name, COALESCE(original.group_nickname, original.account_name) AS original_name, COUNT(*) AS reply_count FROM message reply_msg JOIN message orig_msg ON reply_msg.reply_to_message_id = CAST(orig_msg.id AS TEXT) JOIN member replier ON reply_msg.sender_id = replier.id JOIN member original ON orig_msg.sender_id = original.id WHERE reply_msg.reply_to_message_id IS NOT NULL AND reply_msg.ts > unixepoch('now', '-' || @days || ' days') GROUP BY reply_msg.sender_id, orig_msg.sender_id ORDER BY reply_count DESC LIMIT @limit",
      rowTemplate: '{replier_name} → {original_name}：{reply_count} 次回复',
      summaryTemplate: '回复互动 Top {rowCount}：',
      fallback: '该时间范围内没有回复互动记录',
    },
  },

  // ==================== 情感分析 ====================
  {
    name: 'mutual_interaction_pairs',
    description:
      '找出互动最频繁的成员对，基于双向消息时间接近度（一方发言后 5 分钟内另一方也发言即视为一次互动）。适用于发现关系亲密的好友组合。',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '统计最近多少天的数据' },
        limit: { type: 'number', description: '返回前多少对', default: 10 },
      },
      required: ['days'],
    },
    execution: {
      type: 'sqlite',
      query:
        "SELECT COALESCE(m1.group_nickname, m1.account_name) AS member_a, COALESCE(m2.group_nickname, m2.account_name) AS member_b, COUNT(*) AS interaction_count FROM message a JOIN message b ON b.sender_id != a.sender_id AND b.ts > a.ts AND b.ts <= a.ts + 300 JOIN member m1 ON a.sender_id = m1.id JOIN member m2 ON b.sender_id = m2.id WHERE a.sender_id < b.sender_id AND a.ts > unixepoch('now', '-' || @days || ' days') AND a.type = 0 AND b.type = 0 GROUP BY a.sender_id, b.sender_id ORDER BY interaction_count DESC LIMIT @limit",
      rowTemplate: '{member_a} ↔ {member_b}：{interaction_count} 次互动',
      summaryTemplate: '互动最频繁的 {rowCount} 对好友：',
      fallback: '该时间范围内没有检测到明显的互动关系',
    },
  },
  {
    name: 'member_message_length_stats',
    description: '统计各成员的平均消息长度（仅文本消息），长消息通常意味着更用心的交流。适用于发现深度交流者。',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '统计最近多少天的数据' },
        top_n: { type: 'number', description: '返回前多少名', default: 10 },
      },
      required: ['days'],
    },
    execution: {
      type: 'sqlite',
      query:
        "SELECT COALESCE(m.group_nickname, m.account_name) AS name, COUNT(*) AS msg_count, ROUND(AVG(LENGTH(msg.content)), 1) AS avg_length, MAX(LENGTH(msg.content)) AS max_length FROM message msg JOIN member m ON msg.sender_id = m.id WHERE msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(msg.content) > 0 AND msg.ts > unixepoch('now', '-' || @days || ' days') GROUP BY msg.sender_id HAVING msg_count >= 5 ORDER BY avg_length DESC LIMIT @top_n",
      rowTemplate: '{name} — 平均 {avg_length} 字/条（共 {msg_count} 条，最长 {max_length} 字）',
      summaryTemplate: '消息长度 Top {rowCount}（更长 = 更用心）：',
      fallback: '该时间范围内没有足够的文本消息数据',
    },
  },

  // ==================== 客服分析 ====================
  {
    name: 'unanswered_messages',
    description:
      '查找近 N 天内未被回复的消息，这些可能是未解决的客户问题。仅统计文本消息且内容超过 10 字的（过滤简短寒暄）。',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '查找最近多少天的数据' },
        limit: { type: 'number', description: '最多返回多少条', default: 20 },
      },
      required: ['days'],
    },
    execution: {
      type: 'sqlite',
      query:
        "SELECT COALESCE(m.group_nickname, m.account_name) AS sender_name, datetime(msg.ts, 'unixepoch', 'localtime') AS send_time, SUBSTR(msg.content, 1, 100) AS content_preview FROM message msg JOIN member m ON msg.sender_id = m.id WHERE msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(msg.content) > 10 AND msg.ts > unixepoch('now', '-' || @days || ' days') AND NOT EXISTS (SELECT 1 FROM message reply WHERE reply.reply_to_message_id = CAST(msg.id AS TEXT)) AND NOT EXISTS (SELECT 1 FROM message next WHERE next.sender_id != msg.sender_id AND next.ts > msg.ts AND next.ts <= msg.ts + 1800) ORDER BY msg.ts DESC LIMIT @limit",
      rowTemplate: '[{send_time}] {sender_name}：{content_preview}',
      summaryTemplate: '共发现 {rowCount} 条可能未被回复的消息：',
      fallback: '该时间范围内所有消息都已得到回复，服务质量很好！',
    },
  },
]

/**
 * SQL 分析工具工厂函数数组（与 TS 工具 createTool 模式一致）
 */
export const sqlToolFactories = SQL_TOOL_DEFS.map(
  (def) =>
    (context: ToolContext): AgentTool<any> =>
      createSqlTool(def, context)
)

/**
 * SQL 工具注册表条目（全部为 analysis 类别）
 */
export const sqlToolEntries: ToolRegistryEntry[] = SQL_TOOL_DEFS.map((def) => ({
  name: def.name,
  factory: (context: ToolContext): AgentTool<any> => createSqlTool(def, context),
  category: 'analysis' as const,
}))

/**
 * 所有内置 SQL 工具的名称集合（用于前端分组展示）
 */
export const SQL_TOOL_NAMES = SQL_TOOL_DEFS.map((d) => d.name)

/**
 * 获取内置 SQL 工具目录（供前端展示）
 */
export function getSqlToolCatalog(): Array<{ name: string; description: string }> {
  return SQL_TOOL_DEFS.map((d) => {
    const descKey = `ai.tools.${d.name}.desc`
    const translated = i18nT(descKey)
    return {
      name: d.name,
      description: translated !== descKey ? translated : d.description,
    }
  })
}
