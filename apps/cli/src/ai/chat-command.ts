import { createInterface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'
import type { DatabaseManager, AIChatManager, AgentStreamChunk, TokenUsageData } from '@openchatlab/node-runtime'
import type { PathProvider } from '@openchatlab/core'
import { createCliRunAgentStream } from './agent-stream-runner'

export interface ChatCommandOptions {
  sessionId?: string
  aiChatId?: string
  question?: string
  json?: boolean
  stream?: boolean
  locale?: string
}

export interface ChatCommandDeps {
  dbManager: DatabaseManager
  pathProvider: PathProvider
  aiChatManager: AIChatManager
  stdout?: Pick<Writable, 'write'>
  stderr?: Pick<Writable, 'write'>
  stdin?: Readable
  createRunAgentStream?: typeof createCliRunAgentStream
}

export interface ResolvedAIChatTarget {
  sessionId: string
  aiChatId: string
  assistantId: string
  created: boolean
}

export interface ChatTurnResult {
  sessionId: string
  aiChatId: string
  question: string
  answer: string
  usage: {
    durationMs: number
    tokenUsage: TokenUsageData | null
  }
}

function write(stream: Pick<Writable, 'write'>, text: string): void {
  stream.write(text)
}

function buildTitle(question?: string): string {
  const trimmed = question?.trim()
  if (!trimmed) return 'CLI Chat'
  return trimmed.length > 50 ? `${trimmed.slice(0, 50)}...` : trimmed
}

function createAgentStreamError(error: unknown): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string' && error) return new Error(error)
  if (typeof error === 'object' && error !== null) {
    const record = error as { name?: unknown; message?: unknown; stack?: unknown }
    const streamError = new Error(
      typeof record.message === 'string' && record.message ? record.message : 'Agent stream failed'
    )
    if (typeof record.name === 'string' && record.name) streamError.name = record.name
    if (typeof record.stack === 'string' && record.stack) streamError.stack = record.stack
    return streamError
  }
  return new Error('Agent stream failed')
}

function resolveSingleSessionId(dbManager: DatabaseManager): string {
  const sessionIds = dbManager.listSessionIds()
  if (sessionIds.length === 1) return sessionIds[0]!
  if (sessionIds.length === 0) {
    throw new Error('No chat sessions found. Import data first or run `chatlab sessions` to verify available sessions.')
  }
  throw new Error('Missing --session-id. Run `chatlab sessions` to choose a session ID.')
}

function assertSessionExists(dbManager: DatabaseManager, sessionId: string): void {
  const db = dbManager.open(sessionId)
  if (!db) {
    throw new Error(`Session ${sessionId} not found`)
  }
}

export function resolveAIChatTarget(
  options: Pick<ChatCommandOptions, 'sessionId' | 'aiChatId' | 'question'>,
  deps: Pick<ChatCommandDeps, 'dbManager' | 'aiChatManager'>
): ResolvedAIChatTarget {
  if (options.aiChatId) {
    const aiChat = deps.aiChatManager.getAIChat(options.aiChatId)
    if (!aiChat) {
      throw new Error(`AI chat ${options.aiChatId} not found`)
    }
    if (options.sessionId && options.sessionId !== aiChat.sessionId) {
      throw new Error(`AI chat ${options.aiChatId} belongs to session ${aiChat.sessionId}, not ${options.sessionId}`)
    }
    assertSessionExists(deps.dbManager, aiChat.sessionId)
    return { sessionId: aiChat.sessionId, aiChatId: aiChat.id, assistantId: aiChat.assistantId, created: false }
  }

  const sessionId = options.sessionId ?? resolveSingleSessionId(deps.dbManager)
  assertSessionExists(deps.dbManager, sessionId)
  const aiChat = deps.aiChatManager.createAIChat(sessionId, buildTitle(options.question), 'general_cn')
  return { sessionId, aiChatId: aiChat.id, assistantId: aiChat.assistantId, created: true }
}

export async function runChatTurn(
  options: Required<Pick<ChatCommandOptions, 'question'>> &
    Pick<ChatCommandOptions, 'sessionId' | 'aiChatId' | 'json' | 'stream' | 'locale'>,
  deps: ChatCommandDeps
): Promise<ChatTurnResult> {
  const stdout = deps.stdout ?? process.stdout
  const target = resolveAIChatTarget(options, deps)
  const startedAt = Date.now()
  let answer = ''
  let tokenUsage: TokenUsageData | null = null
  let streamError: Error | null = null

  const runAgentStream = (deps.createRunAgentStream ?? createCliRunAgentStream)(deps.dbManager, deps.aiChatManager)

  await runAgentStream(
    {
      userMessage: options.question,
      sessionId: target.sessionId,
      aiChatId: target.aiChatId,
      assistantId: target.assistantId,
      chatType: 'group',
      locale: options.locale ?? 'zh-CN',
    },
    (chunk: AgentStreamChunk) => {
      if (chunk.type === 'error') {
        streamError = createAgentStreamError(chunk.error)
        return
      }
      if (chunk.type === 'content' && chunk.content) {
        answer += chunk.content
        if (!options.json && options.stream !== false) write(stdout, chunk.content)
      }
      if (chunk.type === 'done' && chunk.usage) {
        tokenUsage = chunk.usage
      }
    },
    new AbortController().signal
  )

  if (streamError) throw streamError

  if (!options.json && options.stream !== false && answer && !answer.endsWith('\n')) {
    write(stdout, '\n')
  }

  deps.aiChatManager.addMessage(target.aiChatId, 'user', options.question)
  deps.aiChatManager.addMessage(
    target.aiChatId,
    'assistant',
    answer,
    undefined,
    undefined,
    undefined,
    tokenUsage ?? undefined
  )

  return {
    sessionId: target.sessionId,
    aiChatId: target.aiChatId,
    question: options.question,
    answer,
    usage: {
      durationMs: Date.now() - startedAt,
      tokenUsage,
    },
  }
}

export async function runChatCommand(options: ChatCommandOptions, deps: ChatCommandDeps): Promise<void> {
  const stdout = deps.stdout ?? process.stdout
  const stderr = deps.stderr ?? process.stderr

  if (options.question?.trim()) {
    const result = await runChatTurn({ ...options, question: options.question.trim() }, deps)
    if (options.json) {
      write(stdout, `${JSON.stringify(result, null, 2)}\n`)
    } else if (options.stream === false) {
      write(stdout, `${result.answer}\n`)
    }
    return
  }

  const rl = createInterface({
    input: deps.stdin ?? process.stdin,
    output: stdout as Writable,
  })

  try {
    let aiChatId = options.aiChatId
    while (true) {
      const question = (await rl.question('chatlab> ')).trim()
      if (!question || question === 'exit' || question === 'quit') break
      try {
        const result = await runChatTurn({ ...options, aiChatId, question, json: false, stream: true }, deps)
        aiChatId = result.aiChatId
      } catch (error) {
        write(stderr, `${error instanceof Error ? error.message : String(error)}\n`)
      }
    }
  } finally {
    rl.close()
  }
}
