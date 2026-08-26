import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import type { AgentStreamRequest, AiRouteContext } from '../../context/ai'
import { chatTopicWorkCoordinator } from '@openchatlab/node-runtime'
import type { MemoryProvenanceCoordinator } from './memory-provenance-coordinator'

const activeAgentAborts = new Map<string, AbortController>()

type AiAgentStreamRouteContext = Pick<AiRouteContext, 'runAgentStream' | 'aiChatManager'>

export function registerAiAgentStreamRoutes(
  server: FastifyInstance,
  ctx: AiAgentStreamRouteContext,
  memoryProvenanceCoordinator?: MemoryProvenanceCoordinator
): void {
  if (!ctx.runAgentStream) return

  const runAgentStream = ctx.runAgentStream

  server.post<{ Body: AgentStreamRequest }>('/_web/ai/agent/stream', async (request, reply) => {
    const requestId = `req_${randomUUID()}`
    const abortController = new AbortController()
    activeAgentAborts.set(requestId, abortController)
    memoryProvenanceCoordinator?.begin(requestId, request.body.aiChatId)

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Request-Id': requestId,
    })

    let emittedDone = false

    const safeSendSSE = (event: string, data: unknown) => {
      if (reply.raw.writableEnded || reply.raw.destroyed) return
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const safeEnd = () => {
      if (reply.raw.writableEnded || reply.raw.destroyed) return
      reply.raw.end()
    }

    safeSendSSE('meta', { requestId })
    const releaseInteractiveWork = chatTopicWorkCoordinator.beginInteractiveWork()

    reply.raw.on('close', () => {
      if (!abortController.signal.aborted) {
        abortController.abort()
      }
      activeAgentAborts.delete(requestId)
    })

    try {
      await runAgentStream(
        request.body,
        (chunk) => {
          if (chunk.type === 'done') emittedDone = true
          if (chunk.type === 'memory_change' && chunk.memoryId) {
            memoryProvenanceCoordinator?.record(requestId, chunk.memoryId)
            safeSendSSE(chunk.type, { ...chunk, provenanceToken: requestId })
            return
          }
          safeSendSSE(chunk.type, chunk)
        },
        abortController.signal
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      safeSendSSE('error', { type: 'error', error: { name: 'ServerError', message: msg } })
    } finally {
      const expectedParentMessageId = ctx.aiChatManager?.getAIChat(request.body.aiChatId)?.activeMessageId ?? null
      memoryProvenanceCoordinator?.complete(requestId, expectedParentMessageId)
      releaseInteractiveWork()
      if (!emittedDone) safeSendSSE('done', { type: 'done', isFinished: true })
      activeAgentAborts.delete(requestId)
      safeEnd()
    }
  })

  server.post<{
    Body: { requestId: string }
  }>('/_web/ai/agent/abort', async (request) => {
    const { requestId } = request.body
    const controller = activeAgentAborts.get(requestId)
    if (controller) {
      controller.abort()
      activeAgentAborts.delete(requestId)
      return { success: true }
    }
    return { success: false }
  })
}
