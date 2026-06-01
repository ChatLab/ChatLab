import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from '../../context'
import { AGENT_TOOL_REGISTRY, CoreDataProvider } from '@openchatlab/tools'
import type { ToolExecutionContext } from '@openchatlab/tools'
import { stripAvatarFields } from '@openchatlab/core'

const MAX_RESULT_CHARS = 500_000
const activeToolTests = new Map<string, AbortController>()

export function registerAiToolRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
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

    const db = ctx.dbManager.open(sessionId)
    if (!db) {
      return reply.code(404).send({ success: false, error: `Session not found: ${sessionId}` })
    }

    const abortController = new AbortController()
    activeToolTests.set(testId, abortController)

    try {
      const execCtx: ToolExecutionContext = {
        sessionId,
        db,
        dataProvider: new CoreDataProvider(db),
      }

      const startTime = Date.now()
      const result = await entry.handler(params, execCtx)
      const elapsed = Date.now() - startTime

      if (abortController.signal.aborted) {
        return { success: false, error: 'cancelled' }
      }

      let details = (result.data as Record<string, unknown> | undefined) ?? undefined
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
        content: [{ type: 'text', text: result.content }],
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
