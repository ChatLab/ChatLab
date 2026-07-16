import { createInterface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'
import type {
  DatabaseManager,
  AIChatManager,
  AgentStreamChunk,
  ContentBlock,
  PlanContentBlock,
  PlanDraftContentBlock,
  TokenUsageData,
} from '@openchatlab/node-runtime'
import type { ChartPayload, PathProvider } from '@openchatlab/core'
import { getDefaultGeneralAssistantId } from '@openchatlab/shared-types'
import { createCliRunAgentStream } from './agent-stream-runner'

export interface ChatCommandOptions {
  sessionId?: string
  aiChatId?: string
  question?: string
  json?: boolean
  stream?: boolean
  locale?: string
  includeEvents?: boolean
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
  events?: AgentStreamChunk[]
  contentBlocks?: ContentBlock[]
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isChartPayload(value: unknown): value is ChartPayload {
  return isRecord(value) && value.version === 1 && isRecord(value.spec) && isRecord(value.dataset)
}

function extractChartPayloads(toolResult: unknown): ChartPayload[] {
  if (!isRecord(toolResult)) return []
  const details = isRecord(toolResult.details) ? toolResult.details : toolResult
  const charts: ChartPayload[] = []
  if (isChartPayload(details.chart)) charts.push(details.chart)
  if (Array.isArray(details.charts)) {
    for (const chart of details.charts) {
      if (isChartPayload(chart)) charts.push(chart)
    }
  }
  return charts
}

function toPersistedChartPayload(chart: ChartPayload): ChartPayload {
  return {
    ...chart,
    dataset: {
      ...chart.dataset,
      rows: [],
    },
  }
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
  options: Pick<ChatCommandOptions, 'sessionId' | 'aiChatId' | 'question' | 'locale'>,
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
  const aiChat = deps.aiChatManager.createAIChat(
    sessionId,
    buildTitle(options.question),
    getDefaultGeneralAssistantId(options.locale)
  )
  return { sessionId, aiChatId: aiChat.id, assistantId: aiChat.assistantId, created: true }
}

export async function runChatTurn(
  options: Required<Pick<ChatCommandOptions, 'question'>> &
    Pick<ChatCommandOptions, 'sessionId' | 'aiChatId' | 'json' | 'stream' | 'locale' | 'includeEvents'>,
  deps: ChatCommandDeps
): Promise<ChatTurnResult> {
  const stdout = deps.stdout ?? process.stdout
  const target = resolveAIChatTarget(options, deps)
  const startedAt = Date.now()
  let answer = ''
  let tokenUsage: TokenUsageData | null = null
  let streamError: Error | null = null
  const events: AgentStreamChunk[] = []
  const contentBlocks: ContentBlock[] = []
  let hasReplayContentBlocks = false

  const runAgentStream = (deps.createRunAgentStream ?? createCliRunAgentStream)(deps.dbManager, deps.aiChatManager)

  // 中文注释：CLI 历史回放依赖 contentBlocks 的时序；只要出现计划/思考块，
  // 就同步保留后续正文 text block，避免 UI 使用 blocks 渲染时丢失最终回答。
  const appendTextBlock = (text: string) => {
    if (!text) return
    const lastBlock = contentBlocks[contentBlocks.length - 1]
    if (lastBlock?.type === 'text') {
      lastBlock.text += text
    } else {
      contentBlocks.push({ type: 'text', text })
    }
  }

  const appendThinkBlock = (text: string, tag = 'thinking', durationMs?: number) => {
    if (!text && durationMs === undefined) return
    const lastBlock = contentBlocks[contentBlocks.length - 1]
    let targetBlock: ContentBlock | undefined

    if (lastBlock?.type === 'think' && lastBlock.tag === tag) {
      lastBlock.text += text
      targetBlock = lastBlock
    } else if (text.trim().length > 0) {
      targetBlock = { type: 'think', tag, text }
      contentBlocks.push(targetBlock)
    } else if (durationMs !== undefined) {
      for (let index = contentBlocks.length - 1; index >= 0; index--) {
        const block = contentBlocks[index]
        if (block.type === 'think' && block.tag === tag) {
          targetBlock = block
          break
        }
      }
    }

    if (durationMs !== undefined && targetBlock?.type === 'think') {
      targetBlock.durationMs = durationMs
    }
    if (targetBlock?.type === 'think') {
      hasReplayContentBlocks = true
    }
  }

  const appendChartBlocks = (charts: ChartPayload[]) => {
    if (charts.length === 0) return
    // 中文注释：图表 block 需要持久化给 CLI 生成的 AI 对话回放；
    // 原始 SQL 行数据可能较大，保存时只保留渲染数据和字段元信息。
    contentBlocks.push(...charts.map((chart) => ({ type: 'chart' as const, chart: toPersistedChartPayload(chart) })))
    hasReplayContentBlocks = true
  }

  const appendPlanDraftBlock = (delta: string) => {
    if (!delta) return
    const lastBlock = contentBlocks[contentBlocks.length - 1]
    if (lastBlock?.type === 'plan_draft') {
      lastBlock.text += delta
    } else {
      contentBlocks.push({ type: 'plan_draft', version: 1, status: 'streaming', text: delta } as PlanDraftContentBlock)
    }
    hasReplayContentBlocks = true
  }

  const removePlanDraftBlocks = () => {
    for (let index = contentBlocks.length - 1; index >= 0; index--) {
      if (contentBlocks[index]?.type === 'plan_draft') {
        contentBlocks.splice(index, 1)
      }
    }
  }

  const appendFinalPlanBlock = (plan: PlanContentBlock) => {
    const planBlock = JSON.parse(JSON.stringify(plan)) as PlanContentBlock
    for (let index = contentBlocks.length - 1; index >= 0; index--) {
      const block = contentBlocks[index]
      if (block?.type === 'plan_draft') {
        const displayText = block.text.trim()
        if (displayText) planBlock.displayText = displayText
        contentBlocks[index] = planBlock
        hasReplayContentBlocks = true
        return
      }
    }
    contentBlocks.push(planBlock)
    hasReplayContentBlocks = true
  }

  await runAgentStream(
    {
      userMessage: options.question,
      sessionId: target.sessionId,
      aiChatId: target.aiChatId,
      assistantId: target.assistantId,
      chatType: 'group',
      locale: options.locale ?? 'zh-CN',
      enableAutoSkill: true,
      chartAutoMode: 'suggest',
    },
    (chunk: AgentStreamChunk) => {
      if (options.includeEvents) {
        events.push(JSON.parse(JSON.stringify(chunk)) as AgentStreamChunk)
      }
      if (chunk.type === 'error') {
        removePlanDraftBlocks()
        streamError = createAgentStreamError(chunk.error)
        return
      }
      if (chunk.type === 'plan_delta' && chunk.planDelta) {
        appendPlanDraftBlock(chunk.planDelta)
        return
      }
      if (chunk.type === 'plan' && chunk.plan) {
        appendFinalPlanBlock(chunk.plan)
        return
      }
      if (chunk.type === 'plan_skipped') {
        removePlanDraftBlocks()
        return
      }
      if (chunk.type === 'think') {
        appendThinkBlock(chunk.content ?? '', chunk.thinkTag, chunk.thinkDurationMs)
        return
      }
      if (chunk.type === 'tool_result' && chunk.toolName === 'render_chart') {
        appendChartBlocks(extractChartPayloads(chunk.toolResult))
        return
      }
      if (chunk.type === 'content' && chunk.content) {
        answer += chunk.content
        appendTextBlock(chunk.content)
        if (!options.json && options.stream !== false) write(stdout, chunk.content)
      }
      if (chunk.type === 'done' && chunk.usage) {
        tokenUsage = chunk.usage
        for (let index = contentBlocks.length - 1; index >= 0; index--) {
          const block = contentBlocks[index]
          if (block.type === 'plan') {
            block.status = 'done'
            break
          }
        }
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
    hasReplayContentBlocks ? contentBlocks : undefined,
    tokenUsage ?? undefined
  )

  return {
    sessionId: target.sessionId,
    aiChatId: target.aiChatId,
    question: options.question,
    answer,
    ...(options.includeEvents ? { events } : {}),
    ...(hasReplayContentBlocks ? { contentBlocks } : {}),
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
