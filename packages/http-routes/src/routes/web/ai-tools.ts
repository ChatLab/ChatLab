import type { FastifyInstance } from 'fastify'
import type { AiRouteContext } from '../../context/ai'
import type { DatabaseManager } from '@openchatlab/node-runtime'
import { appLogger } from '@openchatlab/node-runtime'
import { AGENT_TOOL_REGISTRY, CoreDataProvider } from '@openchatlab/tools'
import { executeRegistryTool } from '../../ai/tool-executor'

const activeToolTests = new Map<string, AbortController>()

interface AiToolRouteContext extends Pick<AiRouteContext, 'executeAiTool'> {
  dbManager: Pick<DatabaseManager, 'open'>
}

export function registerAiToolRoutes(server: FastifyInstance, ctx: AiToolRouteContext): void {
  server.get('/_web/ai/tools/full-catalog', async () => {
    return AGENT_TOOL_REGISTRY.map((tool) => ({
      name: tool.name,
      category: tool.category ?? 'core',
      description: tool.description,
      parameters: tool.inputSchema ?? {},
    }))
  })

  server.post<{
    Body: {
      testId: string
      toolName: string
      params: Record<string, unknown>
      sessionId: string
    }
  }>('/_web/ai/tools/execute', async (request, reply) => {
    const { testId, toolName, params, sessionId } = request.body

    const entry = AGENT_TOOL_REGISTRY.find((t) => t.name === toolName)
    if (!entry) {
      return reply.code(404).send({ success: false, error: `Tool not found: ${toolName}` })
    }

    const abortController = new AbortController()
    activeToolTests.set(testId, abortController)

    try {
      if (ctx.executeAiTool) {
        return await ctx.executeAiTool({ testId, toolName, params, sessionId, abortSignal: abortController.signal })
      }

      const db = ctx.dbManager.open(sessionId)
      if (!db) {
        return reply.code(404).send({ success: false, error: `Session not found: ${sessionId}` })
      }

      const result = await executeRegistryTool(
        { testId, toolName, params, sessionId, abortSignal: abortController.signal },
        {
          db,
          dataProvider: new CoreDataProvider(db),
        }
      )
      if (!result.success && result.error !== 'cancelled') {
        appLogger.error('ai-tools', `Failed to execute tool ${toolName}`, { error: result.error })
      }
      return result
    } catch (error) {
      if (abortController.signal.aborted) {
        return { success: false, error: 'cancelled' }
      }
      appLogger.error('ai-tools', `Failed to execute tool ${toolName}`, error)
      return { success: false, error: String(error) }
    } finally {
      activeToolTests.delete(testId)
    }
  })

  server.post<{ Body: { testId: string } }>('/_web/ai/tools/cancel', async (request) => {
    const { testId } = request.body
    const controller = activeToolTests.get(testId)
    if (controller) {
      controller.abort()
      activeToolTests.delete(testId)
      return { success: true }
    }
    return { success: false }
  })
}
