import { randomUUID } from 'node:crypto'
import type { ChatTopicDay, ChatTopicPreflight, ChatTopicRun, CreateChatTopicsRequest } from '@openchatlab/shared-types'
import { appLogger } from '../../logging/app-logger'
import type { SessionRuntimeAdapter } from '../adapters'
import {
  applyTopicFinalization,
  applyTopicOperations,
  createEmptyTopicLedger,
  materializeChatTopics,
  parseTopicLedger,
  serializeTopicLedger,
  type TopicLedger,
} from './ledger'
import type { ChatTopicModelClient, ChatTopicModelResult } from './model-client'
import {
  CHAT_TOPICS_ALGORITHM_VERSION,
  CHAT_TOPICS_PROMPT_VERSION,
  buildTopicBlockPrompt,
  buildTopicFinalizationPrompt,
  parseTopicFinalizationResponse,
  parseTopicOperationsResponse,
} from './model-protocol'
import { getChatTopicsDbPath } from './paths'
import { createTopicPreflight, loadTopicSourceDay, type TopicSourceDay } from './source'
import { ChatTopicStore, type TopicDayCheckpoint } from './store'
import { assertValidTimezone, enumerateTopicDays } from './time'
import { chatTopicWorkCoordinator } from './work-coordinator'

export interface ChatTopicServiceDeps {
  runtime: SessionRuntimeAdapter
  userDataDir: string
  getModelClient(): ChatTopicModelClient | null
  nativeBinding?: string
  now?: () => number
  generateId?: () => string
}

export interface ChatTopicService {
  preflight(sessionId: string, request: CreateChatTopicsRequest): ChatTopicPreflight
  start(sessionId: string, request: CreateChatTopicsRequest): ChatTopicRun
  generateDay(sessionId: string, dayKey: string, timezone: string, locale?: string): ChatTopicRun
  getRun(sessionId: string, runId: string): ChatTopicRun | null
  getLatestRun(sessionId: string): ChatTopicRun | null
  pause(sessionId: string, runId: string): ChatTopicRun
  resume(sessionId: string, runId: string): ChatTopicRun
  cancel(sessionId: string, runId: string): ChatTopicRun
  getDay(sessionId: string, dayKey: string, timezone: string): ChatTopicDay | null
  deleteDay(sessionId: string, dayKey: string): boolean
  close(): void
}

interface ActiveExecution {
  runId: string
  controller: AbortController
  requestedStatus: 'paused' | 'cancelled' | 'preempted' | null
}

interface PlannedDay {
  dayKey: string
  sourceSignature: string
  totalBlocks: number
  skip: boolean
}

export function createChatTopicService(deps: ChatTopicServiceDeps): ChatTopicService {
  const now = deps.now ?? Date.now
  const generateId = deps.generateId ?? randomUUID
  const store = new ChatTopicStore(getChatTopicsDbPath(deps.userDataDir), { nativeBinding: deps.nativeBinding })
  store.recoverInterruptedRuns(now())
  let activeExecution: ActiveExecution | null = null
  let closed = false
  let storeClosed = false
  let preemptedRunId: string | null = null
  const unsubscribeCoordinator = chatTopicWorkCoordinator.subscribe(handleInteractiveStateChange)
  const unsubscribeSessionDelete = chatTopicWorkCoordinator.subscribeSessionDelete(prepareSessionDelete)
  const executionWaiters: Array<{ runId: string; resolve: () => void }> = []

  function preflight(sessionId: string, request: CreateChatTopicsRequest): ChatTopicPreflight {
    assertOpen()
    assertValidTimezone(request.timezone)
    return createTopicPreflight(
      deps.runtime,
      sessionId,
      request.rangeKind,
      request.timezone,
      Math.floor(now() / 1000),
      request.startDay
    )
  }

  function start(sessionId: string, request: CreateChatTopicsRequest): ChatTopicRun {
    const modelClient = requireModelClient()
    const result = preflight(sessionId, request)
    return createAndLaunchRun({
      sessionId,
      rangeKind: request.rangeKind,
      timezone: request.timezone,
      locale: request.locale,
      startDay: result.startDay,
      endDay: result.endDay,
      totalDays: result.activeDays,
      totalBlocks: result.estimatedBlocks,
      modelId: modelClient.modelId,
    })
  }

  function generateDay(sessionId: string, dayKey: string, timezone: string, locale?: string): ChatTopicRun {
    const modelClient = requireModelClient()
    assertValidTimezone(timezone)
    const source = loadTopicSourceDay(deps.runtime.ensureReadonly(sessionId), dayKey, timezone)
    return createAndLaunchRun({
      sessionId,
      rangeKind: 'day',
      timezone,
      locale,
      startDay: dayKey,
      endDay: dayKey,
      totalDays: source.messages.length > 0 ? 1 : 0,
      totalBlocks: source.blocks.length,
      modelId: modelClient.modelId,
    })
  }

  function createAndLaunchRun(input: {
    sessionId: string
    rangeKind: ChatTopicRun['rangeKind']
    timezone: string
    locale?: string
    startDay: string
    endDay: string
    totalDays: number
    totalBlocks: number
    modelId: string
  }): ChatTopicRun {
    const active = store.getActiveRun()
    if (active) {
      throw Object.assign(new Error(`A chat topic run is already ${active.status}`), {
        statusCode: 409,
        activeRun: active,
      })
    }
    const timestamp = now()
    const run: ChatTopicRun = {
      id: generateId(),
      sessionId: input.sessionId,
      rangeKind: input.rangeKind,
      timezone: input.timezone,
      locale: input.locale ?? null,
      startDay: input.startDay,
      endDay: input.endDay,
      status: input.totalDays === 0 ? 'completed' : 'pending',
      totalDays: input.totalDays,
      completedDays: 0,
      totalBlocks: input.totalBlocks,
      completedBlocks: 0,
      currentDay: null,
      currentBlockIndex: null,
      modelId: input.modelId,
      promptVersion: CHAT_TOPICS_PROMPT_VERSION,
      algorithmVersion: CHAT_TOPICS_ALGORITHM_VERSION,
      inputTokens: 0,
      outputTokens: 0,
      modelCalls: 0,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    store.createRun(run)
    if (run.status === 'pending') launch(run.id)
    return run
  }

  function getRun(sessionId: string, runId: string): ChatTopicRun | null {
    const run = store.getRun(runId)
    return run?.sessionId === sessionId ? run : null
  }

  function getLatestRun(sessionId: string): ChatTopicRun | null {
    return store.getLatestRun(sessionId)
  }

  function pause(sessionId: string, runId: string): ChatTopicRun {
    const run = requireRun(sessionId, runId)
    if (run.status === 'pending' && activeExecution?.runId !== runId) {
      return updateRun(run, { status: 'paused' })
    }
    if (run.status !== 'running' && run.status !== 'pending') return run
    if (activeExecution?.runId === runId) {
      preemptedRunId = null
      activeExecution.requestedStatus = 'paused'
      activeExecution.controller.abort()
      return run
    }
    return updateRun(run, { status: 'paused' })
  }

  function resume(sessionId: string, runId: string): ChatTopicRun {
    const run = requireRun(sessionId, runId)
    if (run.status !== 'paused' && run.status !== 'failed') return run
    requireModelClient()
    const active = store.getActiveRun()
    if (active && active.id !== runId) {
      throw Object.assign(new Error(`A chat topic run is already ${active.status}`), { statusCode: 409 })
    }
    const resumed = updateRun(run, { status: 'pending', lastError: null })
    launch(runId)
    return resumed
  }

  function cancel(sessionId: string, runId: string): ChatTopicRun {
    const run = requireRun(sessionId, runId)
    if (run.status === 'completed' || run.status === 'cancelled') return run
    if (activeExecution?.runId === runId) {
      preemptedRunId = null
      activeExecution.requestedStatus = 'cancelled'
      activeExecution.controller.abort()
    }
    return updateRun(run, { status: 'cancelled' })
  }

  function getDay(sessionId: string, dayKey: string, timezone: string): ChatTopicDay | null {
    assertValidTimezone(timezone)
    const snapshot = store.getDay(sessionId, dayKey)
    if (!snapshot) return null
    const source = loadTopicSourceDay(deps.runtime.ensureReadonly(sessionId), dayKey, timezone)
    store.refreshDayStatus(sessionId, dayKey, source.sourceSignature, timezone, now())
    return store.getDay(sessionId, dayKey)
  }

  function deleteDay(sessionId: string, dayKey: string): boolean {
    const active = store.getActiveRun()
    if (active?.sessionId === sessionId && active.startDay <= dayKey && active.endDay >= dayKey) {
      throw Object.assign(new Error('Cancel the active topic generation before deleting this day'), { statusCode: 409 })
    }
    return store.deleteDay(sessionId, dayKey)
  }

  function close(): void {
    if (closed) return
    closed = true
    unsubscribeCoordinator()
    unsubscribeSessionDelete()
    preemptedRunId = null
    if (activeExecution) {
      activeExecution.requestedStatus = 'paused'
      activeExecution.controller.abort()
      return
    }
    closeStore()
  }

  function launch(runId: string): void {
    if (activeExecution) throw Object.assign(new Error('A chat topic run is already executing'), { statusCode: 409 })
    if (chatTopicWorkCoordinator.isInteractiveActive) {
      preemptedRunId = runId
      return
    }
    const execution: ActiveExecution = { runId, controller: new AbortController(), requestedStatus: null }
    activeExecution = execution
    queueMicrotask(() => {
      void executeRun(execution).finally(() => {
        if (activeExecution === execution) activeExecution = null
        resolveExecutionWaiters(execution.runId)
        resumePreemptedRun()
        if (closed) closeStore()
      })
    })
  }

  async function executeRun(execution: ActiveExecution): Promise<void> {
    let run = store.getRun(execution.runId)
    if (!run) return
    if (execution.controller.signal.aborted) {
      updateRun(run, {
        status: execution.requestedStatus === 'preempted' ? 'pending' : (execution.requestedStatus ?? 'paused'),
      })
      return
    }
    const modelClient = deps.getModelClient()
    if (!modelClient) {
      updateRun(run, { status: 'failed', lastError: 'LLM service is not configured' })
      return
    }
    run = updateRun(run, {
      status: 'running',
      modelId: modelClient.modelId,
      completedDays: 0,
      completedBlocks: 0,
      currentDay: null,
      currentBlockIndex: null,
      lastError: null,
    })
    appLogger.info('chat-topics', 'chat topic generation started', {
      runId: run.id,
      sessionId: run.sessionId,
      startDay: run.startDay,
      endDay: run.endDay,
    })

    try {
      const plans = buildRunPlan(run, modelClient.modelId)
      run = updateRun(run, {
        totalDays: plans.filter((plan) => !plan.skip).length,
        totalBlocks: plans.filter((plan) => !plan.skip).reduce((sum, plan) => sum + plan.totalBlocks, 0),
      })
      for (const plan of plans) {
        execution.controller.signal.throwIfAborted()
        if (plan.skip) continue
        const result = await processDay(run, plan, modelClient, execution.controller.signal)
        run = result.run
      }
      run = updateRun(run, {
        status: 'completed',
        currentDay: null,
        currentBlockIndex: null,
      })
      appLogger.info('chat-topics', 'chat topic generation completed', {
        runId: run.id,
        sessionId: run.sessionId,
        completedDays: run.completedDays,
        modelCalls: run.modelCalls,
      })
    } catch (error) {
      const latest = store.getRun(run.id) ?? run
      const requestedStatus = execution.requestedStatus
      const status = requestedStatus === 'preempted' ? 'pending' : (requestedStatus ?? 'failed')
      const message = requestedStatus ? null : error instanceof Error ? error.message : String(error)
      if (latest.currentDay) markCurrentCheckpointFailed(latest, message)
      updateRun(latest, { status, lastError: message })
      if (!requestedStatus) appLogger.error('chat-topics', 'chat topic generation failed', error)
    }
  }

  function buildRunPlan(run: ChatTopicRun, modelId: string): PlannedDay[] {
    // Use the persisted run boundary so a resumed task cannot silently expand after midnight or after a later import.
    const dayKeys = enumerateTopicDays(run.startDay, run.endDay)
    return dayKeys.flatMap((dayKey) => {
      const source = loadTopicSourceDay(deps.runtime.ensureReadonly(run.sessionId), dayKey, run.timezone)
      if (source.messages.length === 0) return []
      const checkpoint = store.getCheckpoint(run.sessionId, dayKey)
      const snapshot = store.getDay(run.sessionId, dayKey)
      const skip =
        run.rangeKind !== 'day' &&
        checkpoint === null &&
        snapshot?.status === 'ready' &&
        snapshot.sourceSignature === source.sourceSignature &&
        snapshot.timezone === run.timezone &&
        snapshot.modelId === modelId &&
        snapshot.promptVersion === CHAT_TOPICS_PROMPT_VERSION &&
        snapshot.algorithmVersion === CHAT_TOPICS_ALGORITHM_VERSION
      return [{ dayKey, sourceSignature: source.sourceSignature, totalBlocks: source.blocks.length, skip }]
    })
  }

  async function processDay(
    initialRun: ChatTopicRun,
    plan: PlannedDay,
    modelClient: ChatTopicModelClient,
    signal: AbortSignal
  ): Promise<{ run: ChatTopicRun }> {
    let run = updateRun(initialRun, { currentDay: plan.dayKey, currentBlockIndex: 0 })
    const source = loadTopicSourceDay(deps.runtime.ensureReadonly(run.sessionId), plan.dayKey, run.timezone)
    if (source.sourceSignature !== plan.sourceSignature) {
      run = updateRun(run, { totalBlocks: run.totalBlocks - plan.totalBlocks + source.blocks.length })
    }
    const checkpoint = store.getCheckpoint(run.sessionId, plan.dayKey)
    const canResume = isReusableCheckpoint(checkpoint, source, modelClient.modelId)
    let ledger = canResume ? parseTopicLedger(checkpoint.ledgerJson) : createEmptyTopicLedger()
    const startBlock = canResume ? Math.min(checkpoint.completedBlockIndex, source.blocks.length) : 0
    run = updateRun(run, { completedBlocks: run.completedBlocks + startBlock, currentBlockIndex: startBlock })
    saveCheckpoint(run, source, ledger, startBlock, 'running')

    for (let index = startBlock; index < source.blocks.length; index += 1) {
      signal.throwIfAborted()
      run = updateRun(run, { currentBlockIndex: index })
      const block = source.blocks[index]!
      const prompts = buildTopicBlockPrompt({
        chatType: source.chatType,
        dayKey: source.dayKey,
        timezone: source.timezone,
        locale: run.locale ?? undefined,
        ledger,
        block,
        totalBlocks: source.blocks.length,
      })
      const result = await completeValidated(
        run,
        modelClient,
        prompts,
        signal,
        (text) =>
          applyTopicOperations(ledger, parseTopicOperationsResponse(text), {
            sessionId: run.sessionId,
            dayKey: source.dayKey,
            localIdNamespace: `block:${block.index}`,
            currentMessages: block.messages,
          }),
        `chat-topics:${run.sessionId}:${source.dayKey}`
      )
      run = result.run
      ledger = result.value
      run = updateRun(run, { completedBlocks: run.completedBlocks + 1, currentBlockIndex: index + 1 })
      saveCheckpoint(run, source, ledger, index + 1, 'running')
    }

    signal.throwIfAborted()
    const finalPrompts = buildTopicFinalizationPrompt({
      chatType: source.chatType,
      dayKey: source.dayKey,
      timezone: source.timezone,
      locale: run.locale ?? undefined,
      ledger,
    })
    const finalResult = await completeValidated(
      run,
      modelClient,
      finalPrompts,
      signal,
      (text) => {
        const finalization = parseTopicFinalizationResponse(text)
        return { finalization, ledger: applyTopicFinalization(ledger, finalization) }
      },
      `chat-topics:${run.sessionId}:${source.dayKey}`
    )
    run = finalResult.run
    const currentSource = loadTopicSourceDay(deps.runtime.ensureReadonly(run.sessionId), source.dayKey, source.timezone)
    if (currentSource.sourceSignature !== source.sourceSignature) {
      throw new Error('Chat messages changed during topic generation; retry is required')
    }
    store.finalizeDay({
      sessionId: run.sessionId,
      dayKey: source.dayKey,
      timezone: source.timezone,
      sourceSignature: source.sourceSignature,
      sourceMessageCount: source.messages.length,
      sourceFirstTs: source.messages[0]!.timestamp,
      sourceLastTs: source.messages.at(-1)!.timestamp,
      runId: run.id,
      modelId: modelClient.modelId,
      promptVersion: CHAT_TOPICS_PROMPT_VERSION,
      algorithmVersion: CHAT_TOPICS_ALGORITHM_VERSION,
      overview: finalResult.value.finalization.overview,
      topics: materializeChatTopics(finalResult.value.ledger, source.messages),
      generatedAt: now(),
    })
    run = updateRun(run, {
      completedDays: run.completedDays + 1,
      currentDay: null,
      currentBlockIndex: null,
    })
    return { run }
  }

  async function completeValidated<T>(
    initialRun: ChatTopicRun,
    modelClient: ChatTopicModelClient,
    prompts: { systemPrompt: string; userPrompt: string },
    signal: AbortSignal,
    validate: (text: string) => T,
    sessionId: string
  ): Promise<{ run: ChatTopicRun; value: T }> {
    let run = initialRun
    let lastValidationError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attemptPrompts =
        attempt === 0
          ? prompts
          : {
              ...prompts,
              userPrompt: `${prompts.userPrompt}\n\nYour previous response was invalid: ${validationErrorMessage(lastValidationError)}. Return corrected compact JSON only. Stay below 4096 output tokens, keep at most 4 representative evidence items per operation, and include the complete assignments array with current-block message IDs.`,
            }
      const response = await modelClient.complete(attemptPrompts, { signal, sessionId })
      run = recordModelUsage(run, response)
      try {
        return { run, value: validate(response.text) }
      } catch (error) {
        lastValidationError = error
      }
    }
    throw lastValidationError instanceof Error ? lastValidationError : new Error('Invalid topic model response')
  }

  function recordModelUsage(run: ChatTopicRun, result: ChatTopicModelResult): ChatTopicRun {
    return updateRun(run, {
      inputTokens: run.inputTokens + result.inputTokens,
      outputTokens: run.outputTokens + result.outputTokens,
      modelCalls: run.modelCalls + 1,
    })
  }

  function saveCheckpoint(
    run: ChatTopicRun,
    source: TopicSourceDay,
    ledger: TopicLedger,
    completedBlockIndex: number,
    status: TopicDayCheckpoint['status'],
    lastError: string | null = null
  ): void {
    store.saveCheckpoint({
      sessionId: run.sessionId,
      dayKey: source.dayKey,
      timezone: source.timezone,
      status,
      sourceSignature: source.sourceSignature,
      sourceMessageCount: source.messages.length,
      sourceFirstTs: source.messages[0]!.timestamp,
      sourceLastTs: source.messages.at(-1)!.timestamp,
      runId: run.id,
      totalBlocks: source.blocks.length,
      completedBlockIndex,
      ledgerJson: serializeTopicLedger(ledger),
      modelId: run.modelId,
      promptVersion: CHAT_TOPICS_PROMPT_VERSION,
      algorithmVersion: CHAT_TOPICS_ALGORITHM_VERSION,
      lastError,
      updatedAt: now(),
    })
  }

  function markCurrentCheckpointFailed(run: ChatTopicRun, lastError: string | null): void {
    const checkpoint = run.currentDay ? store.getCheckpoint(run.sessionId, run.currentDay) : null
    if (!checkpoint) return
    store.saveCheckpoint({ ...checkpoint, status: 'failed', lastError, updatedAt: now() })
  }

  function isReusableCheckpoint(
    checkpoint: ReturnType<ChatTopicStore['getCheckpoint']>,
    source: TopicSourceDay,
    modelId: string
  ): checkpoint is NonNullable<typeof checkpoint> {
    return Boolean(
      checkpoint &&
      checkpoint.sourceSignature === source.sourceSignature &&
      checkpoint.timezone === source.timezone &&
      checkpoint.totalBlocks === source.blocks.length &&
      checkpoint.modelId === modelId &&
      checkpoint.promptVersion === CHAT_TOPICS_PROMPT_VERSION &&
      checkpoint.algorithmVersion === CHAT_TOPICS_ALGORITHM_VERSION
    )
  }

  function updateRun(run: ChatTopicRun, updates: Partial<ChatTopicRun>): ChatTopicRun {
    const updated = { ...run, ...updates, updatedAt: now() }
    store.updateRun(updated)
    return updated
  }

  function requireRun(sessionId: string, runId: string): ChatTopicRun {
    const run = getRun(sessionId, runId)
    if (!run) throw Object.assign(new Error(`Chat topic run not found: ${runId}`), { statusCode: 404 })
    return run
  }

  function requireModelClient(): ChatTopicModelClient {
    assertOpen()
    const client = deps.getModelClient()
    if (!client) throw Object.assign(new Error('LLM service is not configured'), { statusCode: 400 })
    return client
  }

  function assertOpen(): void {
    if (closed) throw new Error('Chat topic service is closed')
  }

  function closeStore(): void {
    if (storeClosed) return
    storeClosed = true
    store.close()
  }

  function handleInteractiveStateChange(active: boolean): void {
    if (closed) return
    if (active) {
      if (activeExecution && activeExecution.requestedStatus === null) {
        preemptedRunId = activeExecution.runId
        activeExecution.requestedStatus = 'preempted'
        activeExecution.controller.abort()
      }
      return
    }
    resumePreemptedRun()
  }

  function resumePreemptedRun(): void {
    if (closed || chatTopicWorkCoordinator.isInteractiveActive || activeExecution || !preemptedRunId) return
    const runId = preemptedRunId
    const pending = store.getRun(runId)
    if (pending?.status !== 'pending') {
      preemptedRunId = null
      return
    }
    preemptedRunId = null
    launch(runId)
  }

  async function prepareSessionDelete(sessionId: string): Promise<void> {
    const preemptedRun = preemptedRunId ? store.getRun(preemptedRunId) : null
    if (preemptedRun?.sessionId === sessionId) preemptedRunId = null
    if (activeExecution) {
      const activeRun = store.getRun(activeExecution.runId)
      if (activeRun?.sessionId === sessionId) {
        activeExecution.requestedStatus = 'cancelled'
        activeExecution.controller.abort()
        await waitForExecution(activeExecution.runId)
      }
    }
    const activeRun = store.getActiveRun()
    if (activeRun?.sessionId === sessionId) updateRun(activeRun, { status: 'cancelled' })
    store.deleteSession(sessionId)
  }

  function waitForExecution(runId: string): Promise<void> {
    if (activeExecution?.runId !== runId) return Promise.resolve()
    return new Promise((resolve) => executionWaiters.push({ runId, resolve }))
  }

  function resolveExecutionWaiters(runId: string): void {
    for (let index = executionWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = executionWaiters[index]
      if (waiter?.runId !== runId) continue
      executionWaiters.splice(index, 1)
      waiter.resolve()
    }
  }

  return {
    preflight,
    start,
    generateDay,
    getRun,
    getLatestRun,
    pause,
    resume,
    cancel,
    getDay,
    deleteDay,
    close,
  }
}

function validationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500)
}
