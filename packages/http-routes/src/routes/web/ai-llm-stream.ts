import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from '../../context'
import { buildPiModel, runSimpleLlmStream } from '@openchatlab/node-runtime'

export function registerAiLlmStreamRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
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

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    const sendChunk = (data: unknown) => {
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
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      sendChunk({ content: '', isFinished: true, finishReason: 'error', error: msg })
    }

    reply.raw.end()
  })
}
