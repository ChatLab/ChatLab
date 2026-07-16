import type { FastifyInstance } from 'fastify'
import type { AiRouteContext } from '../../context/ai'
import { buildPiModel, runSimpleLlmStream } from '@openchatlab/node-runtime'

type AiLlmStreamRouteContext = Pick<AiRouteContext, 'llmConfigStore'>

export function registerAiLlmStreamRoutes(server: FastifyInstance, ctx: AiLlmStreamRouteContext): void {
  const store = ctx.llmConfigStore
  if (!store) return

  server.post<{
    Body: {
      messages: Array<{ role: string; content: string }>
      options?: { temperature?: number; maxTokens?: number }
    }
  }>('/_web/ai/llm/chat-stream', async (request, reply) => {
    const { messages, options } = request.body

    const llmConfig = store.getDefaultAssistantConfig()
    if (!llmConfig) {
      return reply.code(400).send({ success: false, error: 'LLM service not configured' })
    }

    const piModel = buildPiModel(llmConfig)
    const abortController = new AbortController()

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    reply.raw.on('close', () => {
      if (!abortController.signal.aborted) abortController.abort()
    })

    const sendChunk = (data: unknown) => {
      if (reply.raw.writableEnded || reply.raw.destroyed) return
      reply.raw.write(`event: chunk\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      await runSimpleLlmStream({
        messages,
        apiKey: llmConfig.apiKey,
        piModel,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        onChunk: sendChunk,
        abortSignal: abortController.signal,
      })
    } catch (error) {
      if (abortController.signal.aborted) return
      const msg = error instanceof Error ? error.message : String(error)
      sendChunk({ content: '', isFinished: true, finishReason: 'error', error: msg })
    } finally {
      if (!reply.raw.writableEnded && !reply.raw.destroyed) reply.raw.end()
    }
  })
}
