import type { RuntimeToolDefinition, RuntimeToolResult } from '@openchatlab/ai-runtime'
import { CHAT_DB_TABLES, generateSessionIndex, hasSessionIndex } from '@openchatlab/core'
import {
  CoreDataProvider,
  executeToolForAgent,
  getToolByName,
  type RawMessage,
  type ToolExecutionContext,
} from '@openchatlab/tools'

import { sessionDatabaseFilename, validateSessionId } from '../import/session-paths'
import type { WorkspaceDatabasePort } from '../storage/workspace-database'
import { redactMessages, redactSensitiveText, sanitizeToolValue } from './privacy'

export const WEB_AI_TOOL_NAMES = [
  'get_chat_overview',
  'search_messages',
  'deep_search_messages',
  'get_recent_messages',
  'get_message_context',
  'search_segments',
  'get_segment_messages',
  'get_members',
  'get_member_stats',
  'get_time_stats',
  'get_conversation_between',
  'get_member_name_history',
  'get_schema',
  'execute_sql',
  'render_chart',
] as const

const MAX_TOOL_RESULT_CHARACTERS = 24_000
const WEB_AI_TOOL_SET = new Set<string>(WEB_AI_TOOL_NAMES)

function getDefinitions() {
  return WEB_AI_TOOL_NAMES.map((name) => getToolByName(name)).filter((tool) => tool !== undefined)
}

export class BrowserAIToolRuntime {
  constructor(private readonly database: WorkspaceDatabasePort) {}

  listTools(): RuntimeToolDefinition[] {
    return getDefinitions().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }))
  }

  async execute(
    sessionId: string,
    name: string,
    input: unknown,
    options: { locale?: string; signal?: AbortSignal } = {}
  ): Promise<RuntimeToolResult> {
    validateSessionId(sessionId)
    if (!WEB_AI_TOOL_SET.has(name)) throw new Error(`Tool is not available in Web WASM: ${name}`)
    const definition = getToolByName(name)
    if (!definition) throw new Error(`Unknown tool: ${name}`)
    options.signal?.throwIfAborted()

    return this.database.withDatabase(sessionDatabaseFilename(sessionId), CHAT_DB_TABLES, async (db) => {
      if (name === 'search_segments' && !hasSessionIndex(db)) generateSessionIndex(db)
      const context: ToolExecutionContext = {
        db,
        dataProvider: new CoreDataProvider(db),
        sessionId,
        locale: options.locale,
        abortSignal: options.signal,
        maxMessagesLimit: 1_000,
        maxToolResultTokens: 8_000,
        desensitizeMessages: redactMessages,
      }
      const result = await executeToolForAgent(definition, input, context)
      const details = sanitizeToolValue(result.details)
      const rawMessages =
        details && typeof details === 'object' && Array.isArray((details as { rawMessages?: unknown }).rawMessages)
          ? redactMessages((details as { rawMessages: RawMessage[] }).rawMessages)
          : undefined
      const safeDetails = rawMessages ? { ...(details as Record<string, unknown>), rawMessages } : details
      const safeText = redactSensitiveText(result.content.map((part) => part.text).join('\n'))
      const truncated = safeText.length > MAX_TOOL_RESULT_CHARACTERS
      const content = truncated ? `${safeText.slice(0, MAX_TOOL_RESULT_CHARACTERS)}\n[truncated]` : safeText
      const objectDetails =
        safeDetails && typeof safeDetails === 'object' ? (safeDetails as Record<string, unknown>) : {}
      return {
        content,
        data: safeDetails,
        chart: objectDetails.chart ?? objectDetails.charts,
        evidence: objectDetails.evidence,
        truncated,
      }
    })
  }
}
