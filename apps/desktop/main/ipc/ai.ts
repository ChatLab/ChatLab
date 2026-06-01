/**
 * AI IPC handlers — Electron-only subset
 *
 * Streaming (LLM chat-stream, Agent stream/abort) has been migrated to
 * shared HTTP SSE routes. This file retains:
 * - Debug mode, log file, desensitize rules
 * - LLM non-streaming chat
 * - Tool catalog / execute / cancel
 * - Context token estimation
 */
import { ipcMain, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { aiLogger, setDebugMode } from '../ai/logger'
import { getLogsDir } from '../paths'
import { getDefaultAssistantConfig, buildPiModel } from '../ai/llm'
import { countMessagesTokens, completeSimple, type PiMessage, type PiTextContent } from '@openchatlab/node-runtime'
import { stripAvatarFields } from '@openchatlab/core'
import * as assistantManager from '../ai/assistant'
import * as skillManager from '../ai/skills'
import { getManager as getConversationManager } from '../ai/conversations'
import { t } from '../i18n'
import type { ToolContext } from '../ai/tools/types'
import { TOOL_REGISTRY } from '../ai/tools/definitions'
import { getDefaultRulesForLocale, mergeRulesForLocale } from '@openchatlab/node-runtime'
import type { IpcContext } from './types'

function toPiSimpleMessages(messages: Array<{ role: string; content: string }>, timestamp: number): PiMessage[] {
  return messages.map((message) => ({
    role: message.role as 'user' | 'assistant',
    content: message.content,
    timestamp,
  })) as unknown as PiMessage[]
}

export function registerAIHandlers(_ctx: IpcContext): void {
  console.log('[IPC] Registering AI handlers...')

  try {
    assistantManager.initAssistantManager()
    console.log('[IPC] Assistant manager initialized')
  } catch (error) {
    console.error('[IPC] Failed to initialize assistant manager:', error)
  }

  try {
    skillManager.initSkillManager()
    console.log('[IPC] Skill manager initialized')
  } catch (error) {
    console.error('[IPC] Failed to initialize skill manager:', error)
  }

  // ==================== Debug 模式 ====================

  ipcMain.on('app:setDebugMode', (_, enabled: boolean) => {
    setDebugMode(enabled)
    aiLogger.info('Config', `Debug mode ${enabled ? 'enabled' : 'disabled'}`)
  })

  // ==================== AI 日志 ====================

  ipcMain.handle('ai:showLogFile', async () => {
    try {
      const existingLogPath = aiLogger.getExistingLogPath()
      if (existingLogPath) {
        shell.showItemInFolder(existingLogPath)
        return { success: true, path: existingLogPath }
      }

      const logDir = path.join(getLogsDir(), 'ai')
      if (!fs.existsSync(logDir)) {
        return { success: false, error: 'No AI log files found' }
      }

      const logFiles = fs.readdirSync(logDir).filter((name) => name.startsWith('ai_') && name.endsWith('.log'))

      if (logFiles.length === 0) {
        return { success: false, error: 'No AI log files found' }
      }

      const latestLog = logFiles
        .map((name) => {
          const filePath = path.join(logDir, name)
          const stat = fs.statSync(filePath)
          return { path: filePath, mtimeMs: stat.mtimeMs }
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]

      shell.showItemInFolder(latestLog.path)
      return { success: true, path: latestLog.path }
    } catch (error) {
      console.error('Failed to open AI log file:', error)
      return { success: false, error: String(error) }
    }
  })

  // ==================== 脱敏规则 ====================

  ipcMain.handle('ai:getDefaultDesensitizeRules', (_, locale: string) => {
    return getDefaultRulesForLocale(locale)
  })

  ipcMain.handle('ai:mergeDesensitizeRules', (_, existingRules: unknown[], locale: string) => {
    return mergeRulesForLocale(existingRules as any[], locale)
  })

  // ==================== LLM 直接调用 API（SQLLab 等非 Agent 场景） ====================

  ipcMain.handle(
    'llm:chat',
    async (
      _,
      messages: Array<{ role: string; content: string }>,
      options?: { temperature?: number; maxTokens?: number }
    ) => {
      try {
        const activeConfig = getDefaultAssistantConfig()
        if (!activeConfig) {
          return { success: false, error: t('llm.notConfigured') }
        }
        const piModel = buildPiModel(activeConfig)
        const now = Date.now()
        const systemMsg = messages.find((m) => m.role === 'system')
        const nonSystemMsgs = messages.filter((m) => m.role !== 'system')

        const result = await completeSimple(
          piModel,
          {
            systemPrompt: systemMsg?.content,
            messages: toPiSimpleMessages(nonSystemMsgs, now),
          },
          {
            apiKey: activeConfig.apiKey,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
          }
        )

        const content = result.content
          .filter((item): item is PiTextContent => item.type === 'text')
          .map((item) => item.text)
          .join('')

        return { success: true, content }
      } catch (error) {
        aiLogger.error('IPC', 'llm:chat error', { error: String(error) })
        return { success: false, error: String(error) }
      }
    }
  )

  // ==================== 工具测试 API ====================

  const activeToolTests = new Map<string, AbortController>()

  ipcMain.handle('ai:getToolCatalog', async () => {
    try {
      return TOOL_REGISTRY.map((entry) => {
        const dummyContext: ToolContext = { sessionId: '__catalog__' }
        const tool = entry.factory(dummyContext)
        const descKey = `ai.tools.${entry.name}.desc`
        const translated = t(descKey)
        return {
          name: entry.name,
          category: entry.category,
          description: translated !== descKey ? translated : (tool.description ?? ''),
          parameters: tool.parameters ?? {},
        }
      })
    } catch (error) {
      console.error('Failed to get tool catalog:', error)
      return []
    }
  })

  ipcMain.handle(
    'ai:executeTool',
    async (_, testId: string, toolName: string, params: Record<string, unknown>, sessionId: string) => {
      const MAX_RESULT_CHARS = 500_000
      const abortController = new AbortController()
      activeToolTests.set(testId, abortController)

      try {
        const entry = TOOL_REGISTRY.find((e) => e.name === toolName)
        if (!entry) {
          return { success: false, error: `Tool not found: ${toolName}` }
        }

        const context: ToolContext = { sessionId }
        const tool = entry.factory(context)
        const startTime = Date.now()
        const result = await tool.execute(`test_${Date.now()}`, params)
        const elapsed = Date.now() - startTime

        if (abortController.signal.aborted) {
          return { success: false, error: 'cancelled' }
        }

        let details = result.details as Record<string, unknown> | undefined
        let truncated = false

        if (details) {
          stripAvatarFields(details)
          const raw = JSON.stringify(details)
          if (raw.length > MAX_RESULT_CHARS) {
            truncated = true
            details = { _truncated: true, _originalSize: raw.length, _preview: raw.slice(0, MAX_RESULT_CHARS) }
          }
        }

        return {
          success: true,
          elapsed,
          content: result.content,
          details,
          truncated,
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          return { success: false, error: 'cancelled' }
        }
        console.error(`Failed to execute tool ${toolName}:`, error)
        return { success: false, error: String(error) }
      } finally {
        activeToolTests.delete(testId)
      }
    }
  )

  ipcMain.handle('ai:cancelToolTest', async (_, testId: string) => {
    const controller = activeToolTests.get(testId)
    if (controller) {
      controller.abort()
      activeToolTests.delete(testId)
      return { success: true }
    }
    return { success: false }
  })

  // Agent streaming has been migrated to shared SSE route (ai-agent-stream.ts)

  // ==================== 上下文 token 估算 ====================

  ipcMain.handle('ai:estimateContextTokens', async (_, conversationId: string) => {
    try {
      const history = getConversationManager().getHistoryForAgent(conversationId)
      const tokens = countMessagesTokens(history.map((m) => ({ role: m.role, content: m.content })))
      return { success: true, tokens, messageCount: history.length }
    } catch (error) {
      return { success: false, tokens: 0, error: String(error) }
    }
  })
}
