import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext, AgentStreamRequest } from '../../context'

const activeAgentAborts = new Map<string, AbortController>()

export function registerAiAgentStreamRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  if (!ctx.runAgentStream) return

  const runAgentStream = ctx.runAgentStream

  server.post<{ Body: AgentStreamRequest }>('/_web/ai/agent/stream', async (request, reply) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const abortController = new AbortController()
    activeAgentAborts.set(requestId, abortController)

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Request-Id': requestId,
    })

    const sendSSE = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    sendSSE('meta', { requestId })

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
          sendSSE(chunk.type, chunk)
          if (chunk.type === 'done') {
            activeAgentAborts.delete(requestId)
            reply.raw.end()
          }
        },
        abortController.signal
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      sendSSE('error', { type: 'error', error: { name: 'ServerError', message: msg } })
      sendSSE('done', { type: 'done', isFinished: true })
      activeAgentAborts.delete(requestId)
      reply.raw.end()
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
