import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURRENT_SCHEMA_VERSION } from '@openchatlab/core'
import type { BrowserCapabilityReport, RpcResponseEnvelope } from '../rpc/protocol'
import type { BrowserImportProgress, BrowserTimeFilter } from '../import/session-runtime'
import type { BrowserParseSource } from '../import/chatlab-parser'
import { WebRuntimeError } from '../runtime-error'
import type { DatabaseOpenStage } from '../sqlite/database-runtime'
import {
  WebRuntimeWorkerController,
  type WorkerDatabaseRuntime,
  type WorkerMessageSink,
  type WorkerSessionRuntime,
} from './controller'

const supportedCapabilities: BrowserCapabilityReport = {
  supported: true,
  missing: [],
  capabilities: {
    webAssembly: true,
    dedicatedWorker: true,
    opfs: true,
    storageEstimate: true,
    secureContext: true,
  },
}

class CapturingSink implements WorkerMessageSink {
  readonly messages: RpcResponseEnvelope[] = []

  postMessage(message: RpcResponseEnvelope): void {
    this.messages.push(message)
  }
}

class FakeDatabaseRuntime implements WorkerDatabaseRuntime {
  openCalls: string[] = []
  closeCalls = 0
  closeGate: Promise<void> | undefined
  workspaceLeaseCalls = 0

  async withWorkspaceLease<T>(operation: () => Promise<T>): Promise<T> {
    this.workspaceLeaseCalls += 1
    return operation()
  }

  async open(filename: string, onStage?: (stage: DatabaseOpenStage) => void) {
    this.openCalls.push(filename)
    onStage?.('sqlite-ready')
    onStage?.('opfs-pool-ready')
    onStage?.('schema-ready')
    return { filename, sqliteVersion: '3.53.0', schemaVersion: CURRENT_SCHEMA_VERSION }
  }

  async close(): Promise<{ closed: boolean }> {
    this.closeCalls += 1
    await this.closeGate
    return { closed: true }
  }

  async withDatabase<T>(_filename: string, _schemaSql: string, _operation: never): Promise<T> {
    throw new Error('not used')
  }

  async deleteDatabase(_filename: string): Promise<boolean> {
    return false
  }

  async ensureCapacity(minimum: number): Promise<number> {
    return minimum
  }

  async getDatabaseFilenames(): Promise<string[]> {
    return []
  }
}

class FakeSessionRuntime implements WorkerSessionRuntime {
  readonly hourlyCalls: Array<{ id: string; filter?: BrowserTimeFilter }> = []
  readonly dailyCalls: Array<{ id: string; filter?: BrowserTimeFilter }> = []
  readonly weekdayCalls: Array<{ id: string; filter?: BrowserTimeFilter }> = []
  readonly memberCalls: Array<{ id: string; filter?: BrowserTimeFilter }> = []
  readonly messageTypeCalls: Array<{ id: string; filter?: BrowserTimeFilter }> = []
  readonly messageLengthCalls: Array<{ id: string; filter?: BrowserTimeFilter }> = []
  readonly textStatsCalls: Array<{ id: string; filter?: BrowserTimeFilter }> = []
  readonly longMessageCalls: Array<{ id: string; filter?: BrowserTimeFilter; minLength?: number }> = []
  readonly textPercentileCalls: Array<{ id: string; filter?: BrowserTimeFilter }> = []
  readonly timeRangeCalls: string[] = []
  readonly availableYearsCalls: string[] = []
  readonly importCalls: Array<{ chatIndex?: number }> = []
  readonly session = {
    id: 'session-one',
    name: 'One',
    platform: 'wechat',
    type: 'group',
    importedAt: 1,
    messageCount: 2,
    memberCount: 1,
    groupId: null,
    groupAvatar: null,
    ownerId: null,
    lastMessageTs: 2,
    formatId: 'chatlab',
  }

  async detectFormat(_source: BrowserParseSource) {
    return 'chatlab' as const
  }

  getSupportedFormats() {
    return [{ id: 'chatlab' as const, name: 'ChatLab JSON', platform: 'unknown' as const, extensions: ['.json'] }]
  }

  async scanMultiChatSource(_source: BrowserParseSource) {
    return [{ index: 1, name: 'Project Team', type: 'private_group', id: 4242, messageCount: 2 }]
  }

  async importSource(
    _source: BrowserParseSource,
    options: { chatIndex?: number; onProgress?: (progress: BrowserImportProgress) => void; checkCancelled?: () => void }
  ) {
    this.importCalls.push({ chatIndex: options.chatIndex })
    options.checkCancelled?.()
    options.onProgress?.({ stage: 'parsing', progress: 0.5, messagesProcessed: 1 })
    return { sessionId: 'session-one', formatId: 'chatlab' as const, messageCount: 2, memberCount: 1, skippedCount: 0 }
  }

  async listSessions(onStage?: (stage: DatabaseOpenStage) => void) {
    onStage?.('sqlite-ready')
    onStage?.('opfs-pool-ready')
    onStage?.('opfs-database-opened')
    onStage?.('schema-ready')
    return [this.session]
  }

  async getSession(id: string) {
    return id === this.session.id ? this.session : null
  }

  async deleteSession(id: string) {
    return id === this.session.id
  }

  async renameSession(id: string, _newName: string) {
    return id === this.session.id
  }

  async getHourlyActivity(id: string, filter?: BrowserTimeFilter) {
    this.hourlyCalls.push({ id, filter })
    return id === this.session.id
      ? Array.from({ length: 24 }, (_, hour) => ({ hour, messageCount: hour === 8 ? 2 : 0 }))
      : []
  }

  async getDailyActivity(id: string, filter?: BrowserTimeFilter) {
    this.dailyCalls.push({ id, filter })
    return id === this.session.id ? [{ date: '2024-01-02', messageCount: 2 }] : []
  }

  async getWeekdayActivity(id: string, filter?: BrowserTimeFilter) {
    this.weekdayCalls.push({ id, filter })
    return id === this.session.id
      ? Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, messageCount: index === 1 ? 2 : 0 }))
      : []
  }

  async getTimeRange(id: string) {
    this.timeRangeCalls.push(id)
    return id === this.session.id ? { start: 1, end: 2 } : null
  }

  async getAvailableYears(id: string) {
    this.availableYearsCalls.push(id)
    return id === this.session.id ? [2024] : []
  }

  async getMemberActivity(id: string, filter?: BrowserTimeFilter) {
    this.memberCalls.push({ id, filter })
    return id === this.session.id
      ? [
          {
            memberId: 1,
            platformId: 'alice',
            name: 'Alice',
            avatar: null,
            messageCount: 2,
            percentage: 100,
          },
        ]
      : []
  }

  async getMessageTypeDistribution(id: string, filter?: BrowserTimeFilter) {
    this.messageTypeCalls.push({ id, filter })
    return id === this.session.id
      ? [
          { type: 1, count: 2 },
          { type: 0, count: 1 },
        ]
      : []
  }

  async getMessageLengthDistribution(id: string, filter?: BrowserTimeFilter) {
    this.messageLengthCalls.push({ id, filter })
    return id === this.session.id
      ? { detail: [{ len: 1, count: 2 }], grouped: [{ range: '1-5', count: 2 }] }
      : { detail: [], grouped: [] }
  }

  async getTextStats(id: string, filter?: BrowserTimeFilter) {
    this.textStatsCalls.push({ id, filter })
    return id === this.session.id
      ? { textCount: 2, avgLength: 3.5, maxLength: 5, shortCount: 2 }
      : { textCount: 0, avgLength: 0, maxLength: 0, shortCount: 0 }
  }

  async getLongMessageCount(id: string, filter?: BrowserTimeFilter, minLength?: number) {
    this.longMessageCalls.push({ id, filter, minLength })
    return id === this.session.id ? 1 : 0
  }

  async getTextLengthPercentiles(id: string, filter?: BrowserTimeFilter) {
    this.textPercentileCalls.push({ id, filter })
    return id === this.session.id ? { p25: 1, p50: 3, p75: 5, p90: 5 } : { p25: 0, p50: 0, p75: 0, p90: 0 }
  }

  async getMonthlyActivity(_id: string, _filter?: BrowserTimeFilter) {
    return [{ month: 1, messageCount: 2 }]
  }

  async getYearlyActivity(_id: string, _filter?: BrowserTimeFilter) {
    return [{ year: 2024, messageCount: 2 }]
  }

  async getMemberMonthlyTrend(_id: string, _filter?: BrowserTimeFilter) {
    return [{ month: '2024-01', memberId: 1, memberName: 'Alice', count: 2 }]
  }

  async getMembers(_id: string) {
    return [
      {
        id: 1,
        platformId: 'alice',
        accountName: 'Alice',
        groupNickname: null,
        aliases: [],
        avatar: null,
        messageCount: 2,
        lastMessageTs: 2,
      },
    ]
  }

  async getMentionAnalysis(_id: string, _filter?: BrowserTimeFilter) {
    return { topMentioners: [], topMentioned: [], totalMentions: 0 }
  }

  async getMentionGraph(_id: string, _filter?: BrowserTimeFilter) {
    return { nodes: [], links: [], maxLinkValue: 0 }
  }

  async getClusterGraph(_id: string, _filter?: BrowserTimeFilter) {
    return {
      nodes: [],
      links: [],
      maxLinkValue: 0,
      communities: [],
      stats: { totalMembers: 0, totalMessages: 0, involvedMembers: 0, edgeCount: 0, communityCount: 0 },
    }
  }

  async getRelationshipStats(_id: string, _filter?: BrowserTimeFilter) {
    return {
      months: [],
      members: [],
      totalSessions: 0,
      hasSessionIndex: true,
      iceBreakers: [],
      responseLatency: [],
      perseverance: [],
      monthlyResponseLatency: [],
      monthlyPerseverance: [],
    }
  }

  async getJourneyStats(_id: string, _filter?: BrowserTimeFilter) {
    return {
      range: null,
      hasSessionIndex: true,
      months: [],
      years: [],
      peakMonth: null,
      longestSegment: null,
      longestSilence: null,
    }
  }

  async getLanguagePreferenceAnalysis(_id: string, _locale: string, _filter?: BrowserTimeFilter) {
    return { members: [], sharedWords: [], similarityScore: 0 }
  }

  async getWordFrequency(_id: string) {
    return { words: [], totalWords: 0, totalMessages: 0, uniqueWords: 0 }
  }
}

describe('WebRuntimeWorkerController', () => {
  it('routes database open through progress, logs, and a typed result envelope', async () => {
    const sink = new CapturingSink()
    const runtime = new FakeDatabaseRuntime()
    const controller = new WebRuntimeWorkerController(sink, runtime, () => supportedCapabilities)

    controller.handleMessage({ id: 'open-1', type: 'db.open', payload: { filename: '/session.db' } })
    await waitForMessage(sink, 'open-1', 'result')

    assert.deepEqual(runtime.openCalls, ['/session.db'])
    assert.deepEqual(
      sink.messages
        .filter((message) => message.id === 'open-1' && message.type === 'progress')
        .map((message) => (message.type === 'progress' ? message.payload.stage : '')),
      ['capabilities-ready', 'sqlite-ready', 'opfs-pool-ready', 'schema-ready']
    )
    assert.equal(
      sink.messages.some((message) => message.id === 'open-1' && message.type === 'log'),
      true
    )
    assert.deepEqual(
      sink.messages.find((message) => message.id === 'open-1' && message.type === 'result'),
      {
        id: 'open-1',
        type: 'result',
        payload: {
          taskType: 'db.open',
          result: { filename: '/session.db', sqliteVersion: '3.53.0', schemaVersion: CURRENT_SCHEMA_VERSION },
        },
      }
    )
  })

  it('returns a structured unsupported-browser error before opening SQLite', async () => {
    const sink = new CapturingSink()
    const runtime = new FakeDatabaseRuntime()
    const controller = new WebRuntimeWorkerController(sink, runtime, () => ({
      ...supportedCapabilities,
      supported: false,
      missing: ['opfs'],
      capabilities: { ...supportedCapabilities.capabilities, opfs: false },
    }))

    controller.handleMessage({ id: 'open-2', type: 'db.open', payload: { filename: '/session.db' } })
    const error = await waitForMessage(sink, 'open-2', 'error')

    assert.deepEqual(runtime.openCalls, [])
    assert.equal(error.type === 'error' ? error.payload.error.code : '', 'UNSUPPORTED_BROWSER')
  })

  it('cancels queued work without running it and serializes runtime failures', async () => {
    const sink = new CapturingSink()
    const runtime = new FakeDatabaseRuntime()
    let releaseFirstClose!: () => void
    runtime.closeGate = new Promise<void>((resolve) => {
      releaseFirstClose = resolve
    })
    const controller = new WebRuntimeWorkerController(sink, runtime, () => supportedCapabilities)

    controller.handleMessage({ id: 'close-1', type: 'db.close', payload: undefined })
    controller.handleMessage({ id: 'close-2', type: 'db.close', payload: undefined })
    controller.handleMessage({ id: 'close-2', type: 'cancel', payload: { reason: 'cancelled' } })
    releaseFirstClose()

    await waitForMessage(sink, 'close-1', 'result')
    const cancelled = await waitForMessage(sink, 'close-2', 'error')
    assert.equal(runtime.closeCalls, 1)
    assert.equal(cancelled.type === 'error' ? cancelled.payload.error.code : '', 'REQUEST_CANCELLED')

    runtime.close = async () => {
      throw new WebRuntimeError('DB_CLOSE_FAILED', 'Could not close database')
    }
    controller.handleMessage({ id: 'close-3', type: 'db.close', payload: undefined })
    const failed = await waitForMessage(sink, 'close-3', 'error')
    assert.equal(failed.type === 'error' ? failed.payload.error.code : '', 'DB_CLOSE_FAILED')
  })

  it('returns the result when a catalog mutation finishes after cancellation is requested', async () => {
    const sink = new CapturingSink()
    const database = new FakeDatabaseRuntime()
    const sessions = new FakeSessionRuntime()
    let markRenameStarted!: () => void
    let releaseRename!: () => void
    const renameStarted = new Promise<void>((resolve) => {
      markRenameStarted = resolve
    })
    const renameGate = new Promise<void>((resolve) => {
      releaseRename = resolve
    })
    sessions.renameSession = async () => {
      markRenameStarted()
      await renameGate
      return true
    }
    const controller = new WebRuntimeWorkerController(sink, database, () => supportedCapabilities, sessions)

    controller.handleMessage({
      id: 'rename-cancelled-after-write',
      type: 'session.rename',
      payload: { sessionId: 'session-one', name: 'Renamed' },
    })
    await renameStarted
    controller.handleMessage({
      id: 'rename-cancelled-after-write',
      type: 'cancel',
      payload: { reason: 'cancelled' },
    })
    releaseRename()

    const completed = await waitForMessage(sink, 'rename-cancelled-after-write', 'result')
    assert.deepEqual(completed.type === 'result' ? completed.payload.result : null, { renamed: true })
    assert.equal(
      sink.messages.some((message) => message.id === 'rename-cancelled-after-write' && message.type === 'error'),
      false
    )
  })

  it('routes import progress and session catalog tasks through the session runtime', async () => {
    const sink = new CapturingSink()
    const database = new FakeDatabaseRuntime()
    const sessions = new FakeSessionRuntime()
    const controller = new WebRuntimeWorkerController(sink, database, () => supportedCapabilities, sessions)
    const source = createSource('fixture.json', '{}')

    controller.handleMessage({ id: 'detect-1', type: 'import.detectFormat', payload: { source } })
    controller.handleMessage({ id: 'scan-1', type: 'import.scanChats', payload: { source } })
    controller.handleMessage({
      id: 'import-1',
      type: 'import.start',
      payload: { source, formatId: 'chatlab', chatIndex: 1 },
    })
    controller.handleMessage({ id: 'list-1', type: 'session.list', payload: undefined })
    controller.handleMessage({
      id: 'hourly-1',
      type: 'analysis.hourly',
      payload: { sessionId: 'session-one', filter: { startTs: 1 } },
    })
    controller.handleMessage({
      id: 'daily-1',
      type: 'analysis.daily',
      payload: { sessionId: 'session-one', filter: { startTs: 1 } },
    })
    controller.handleMessage({
      id: 'weekday-1',
      type: 'analysis.weekday',
      payload: { sessionId: 'session-one', filter: { endTs: 2 } },
    })
    controller.handleMessage({
      id: 'time-range-1',
      type: 'analysis.timeRange',
      payload: { sessionId: 'session-one' },
    })
    controller.handleMessage({
      id: 'available-years-1',
      type: 'analysis.availableYears',
      payload: { sessionId: 'session-one' },
    })
    controller.handleMessage({
      id: 'members-1',
      type: 'analysis.members',
      payload: { sessionId: 'session-one', filter: { endTs: 2 } },
    })
    controller.handleMessage({
      id: 'message-types-1',
      type: 'analysis.messageTypes',
      payload: { sessionId: 'session-one', filter: { startTs: 1, endTs: 2 } },
    })
    controller.handleMessage({
      id: 'message-lengths-1',
      type: 'analysis.messageLengths',
      payload: { sessionId: 'session-one', filter: { startTs: 1 } },
    })
    controller.handleMessage({
      id: 'text-stats-1',
      type: 'analysis.textStats',
      payload: { sessionId: 'session-one', filter: { endTs: 2 } },
    })
    controller.handleMessage({
      id: 'long-messages-1',
      type: 'analysis.longMessages',
      payload: { sessionId: 'session-one', filter: { startTs: 1 }, minLength: 30 },
    })
    controller.handleMessage({
      id: 'text-percentiles-1',
      type: 'analysis.textPercentiles',
      payload: { sessionId: 'session-one', filter: { endTs: 2 } },
    })
    controller.handleMessage({
      id: 'rename-1',
      type: 'session.rename',
      payload: { sessionId: 'session-one', name: 'New' },
    })

    const detected = await waitForMessage(sink, 'detect-1', 'result')
    const scanned = await waitForMessage(sink, 'scan-1', 'result')
    const imported = await waitForMessage(sink, 'import-1', 'result')
    const listed = await waitForMessage(sink, 'list-1', 'result')
    const hourly = await waitForMessage(sink, 'hourly-1', 'result')
    const daily = await waitForMessage(sink, 'daily-1', 'result')
    const weekday = await waitForMessage(sink, 'weekday-1', 'result')
    const timeRange = await waitForMessage(sink, 'time-range-1', 'result')
    const availableYears = await waitForMessage(sink, 'available-years-1', 'result')
    const members = await waitForMessage(sink, 'members-1', 'result')
    const messageTypes = await waitForMessage(sink, 'message-types-1', 'result')
    const messageLengths = await waitForMessage(sink, 'message-lengths-1', 'result')
    const textStats = await waitForMessage(sink, 'text-stats-1', 'result')
    const longMessages = await waitForMessage(sink, 'long-messages-1', 'result')
    const textPercentiles = await waitForMessage(sink, 'text-percentiles-1', 'result')
    const renamed = await waitForMessage(sink, 'rename-1', 'result')

    assert.deepEqual(detected.type === 'result' ? detected.payload.result : null, sessions.getSupportedFormats()[0])
    assert.deepEqual(scanned.type === 'result' ? scanned.payload.result : null, [
      { index: 1, name: 'Project Team', type: 'private_group', id: 4242, messageCount: 2 },
    ])
    assert.deepEqual(imported.type === 'result' ? imported.payload.result : null, {
      sessionId: 'session-one',
      formatId: 'chatlab',
      messageCount: 2,
      memberCount: 1,
      skippedCount: 0,
    })
    assert.deepEqual(listed.type === 'result' ? listed.payload.result : null, [sessions.session])
    assert.deepEqual(
      hourly.type === 'result' ? hourly.payload.result : null,
      Array.from({ length: 24 }, (_, hour) => ({ hour, messageCount: hour === 8 ? 2 : 0 }))
    )
    assert.deepEqual(sessions.hourlyCalls[0], { id: 'session-one', filter: { startTs: 1 } })
    assert.deepEqual(daily.type === 'result' ? daily.payload.result : null, [{ date: '2024-01-02', messageCount: 2 }])
    assert.deepEqual(sessions.dailyCalls[0], { id: 'session-one', filter: { startTs: 1 } })
    assert.deepEqual(
      weekday.type === 'result' ? weekday.payload.result : null,
      Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, messageCount: index === 1 ? 2 : 0 }))
    )
    assert.deepEqual(sessions.weekdayCalls[0], { id: 'session-one', filter: { endTs: 2 } })
    assert.deepEqual(timeRange.type === 'result' ? timeRange.payload.result : null, { start: 1, end: 2 })
    assert.deepEqual(sessions.timeRangeCalls, ['session-one'])
    assert.deepEqual(availableYears.type === 'result' ? availableYears.payload.result : null, [2024])
    assert.deepEqual(sessions.availableYearsCalls, ['session-one'])
    assert.deepEqual(members.type === 'result' ? members.payload.result : null, [
      {
        memberId: 1,
        platformId: 'alice',
        name: 'Alice',
        avatar: null,
        messageCount: 2,
        percentage: 100,
      },
    ])
    assert.deepEqual(sessions.memberCalls[0], { id: 'session-one', filter: { endTs: 2 } })
    assert.deepEqual(messageTypes.type === 'result' ? messageTypes.payload.result : null, [
      { type: 1, count: 2 },
      { type: 0, count: 1 },
    ])
    assert.deepEqual(sessions.messageTypeCalls[0], {
      id: 'session-one',
      filter: { startTs: 1, endTs: 2 },
    })
    assert.deepEqual(messageLengths.type === 'result' ? messageLengths.payload.result : null, {
      detail: [{ len: 1, count: 2 }],
      grouped: [{ range: '1-5', count: 2 }],
    })
    assert.deepEqual(sessions.messageLengthCalls[0], { id: 'session-one', filter: { startTs: 1 } })
    assert.deepEqual(textStats.type === 'result' ? textStats.payload.result : null, {
      textCount: 2,
      avgLength: 3.5,
      maxLength: 5,
      shortCount: 2,
    })
    assert.deepEqual(sessions.textStatsCalls[0], { id: 'session-one', filter: { endTs: 2 } })
    assert.equal(longMessages.type === 'result' ? longMessages.payload.result : null, 1)
    assert.deepEqual(sessions.longMessageCalls[0], {
      id: 'session-one',
      filter: { startTs: 1 },
      minLength: 30,
    })
    assert.deepEqual(textPercentiles.type === 'result' ? textPercentiles.payload.result : null, {
      p25: 1,
      p50: 3,
      p75: 5,
      p90: 5,
    })
    assert.deepEqual(sessions.textPercentileCalls[0], { id: 'session-one', filter: { endTs: 2 } })
    assert.deepEqual(sessions.importCalls, [{ chatIndex: 1 }])
    assert.deepEqual(renamed.type === 'result' ? renamed.payload.result : null, { renamed: true })
    assert.equal(
      sink.messages.some(
        (message) => message.id === 'import-1' && message.type === 'progress' && message.payload.stage === 'parsing'
      ),
      true
    )
    assert.deepEqual(
      sink.messages
        .filter((message) => message.id === 'list-1' && message.type === 'log')
        .map((message) => (message.type === 'log' ? message.payload.message : '')),
      ['sqlite-ready', 'opfs-pool-ready', 'opfs-database-opened', 'schema-ready']
    )
    assert.equal(database.workspaceLeaseCalls, 14)
  })

  it('routes the complete Insights query set through the Worker runtime', async () => {
    const sink = new CapturingSink()
    const controller = new WebRuntimeWorkerController(
      sink,
      new FakeDatabaseRuntime(),
      () => supportedCapabilities,
      new FakeSessionRuntime()
    )
    const requests = [
      { id: 'monthly', type: 'analysis.monthly', payload: { sessionId: 'session-one' } },
      { id: 'yearly', type: 'analysis.yearly', payload: { sessionId: 'session-one' } },
      { id: 'trend', type: 'analysis.memberMonthlyTrend', payload: { sessionId: 'session-one' } },
      { id: 'members', type: 'analysis.memberList', payload: { sessionId: 'session-one' } },
      { id: 'mentions', type: 'analysis.mentions', payload: { sessionId: 'session-one' } },
      { id: 'mention-graph', type: 'analysis.mentionGraph', payload: { sessionId: 'session-one' } },
      { id: 'cluster', type: 'analysis.clusterGraph', payload: { sessionId: 'session-one' } },
      { id: 'relationship', type: 'analysis.relationship', payload: { sessionId: 'session-one' } },
      { id: 'journey', type: 'analysis.journey', payload: { sessionId: 'session-one' } },
      {
        id: 'language',
        type: 'analysis.languagePreference',
        payload: { sessionId: 'session-one', locale: 'en-US' },
      },
      {
        id: 'words',
        type: 'analysis.wordFrequency',
        payload: { sessionId: 'session-one', params: { locale: 'en-US' } },
      },
    ] as const

    for (const request of requests) controller.handleMessage(request)
    for (const request of requests) {
      const result = await waitForMessage(sink, request.id, 'result')
      assert.equal(result.type === 'result' ? result.payload.taskType : null, request.type)
      assert.equal(
        sink.messages.some((message) => message.id === request.id && message.type === 'log'),
        true
      )
    }
  })
})

function createSource(name: string, content: string): BrowserParseSource {
  const blob = new Blob([content])
  return {
    name,
    size: blob.size,
    text: () => blob.text(),
    arrayBuffer: () => blob.arrayBuffer(),
    slice: (start, end) => blob.slice(start, end),
  }
}

async function waitForMessage(
  sink: CapturingSink,
  id: string,
  type: RpcResponseEnvelope['type']
): Promise<RpcResponseEnvelope> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const message = sink.messages.find((candidate) => candidate.id === id && candidate.type === type)
    if (message) return message
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error(`Timed out waiting for ${type} response for ${id}`)
}
