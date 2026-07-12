import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { PullEngine } from './pull-engine'
import type {
  DataSource,
  DataImporter,
  FetchParams,
  HttpFetcher,
  ImportSession,
  SyncLogger,
  SyncNotifier,
} from './types'

const tempFiles: string[] = []

afterEach(() => {
  for (const file of tempFiles.splice(0)) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file)
    } catch {
      /* ignore */
    }
  }
})

function writeTempJson(data: unknown): string {
  const file = path.join(os.tmpdir(), `chatlab-pull-engine-test-${process.pid}-${tempFiles.length}.json`)
  fs.writeFileSync(file, JSON.stringify(data), 'utf-8')
  tempFiles.push(file)
  return file
}

async function withImmediateTimers<T>(fn: () => Promise<T>): Promise<T> {
  const originalSetTimeout = globalThis.setTimeout
  ;(globalThis as any).setTimeout = (callback: (...args: any[]) => void) => {
    callback()
    return 0
  }
  try {
    return await fn()
  } finally {
    globalThis.setTimeout = originalSetTimeout
  }
}

function createDataSource(): DataSource {
  return {
    id: 'ds_test',
    name: 'Test Source',
    baseUrl: 'http://example.test/api/v1',
    token: '',
    intervalMinutes: 10,
    pullLimit: 1000,
    enabled: true,
    createdAt: 1,
    sessions: [],
  }
}

function createSession(): ImportSession {
  return {
    id: 'is_test',
    name: 'Test Session',
    remoteSessionId: 'remote_session',
    targetSessionId: 'local_session',
    lastPullAt: 100,
    lastStatus: 'idle',
    lastError: '',
    lastNewMessages: 0,
  }
}

function createSessionWithId(id: string): ImportSession {
  return {
    ...createSession(),
    id,
    name: `Test Session ${id}`,
    remoteSessionId: `remote_${id}`,
    targetSessionId: `local_${id}`,
  }
}

function createFetchFailedError(code = 'ECONNREFUSED'): Error {
  const cause = Object.assign(new Error(`connect ${code} 127.0.0.1:5031`), {
    code,
    address: '127.0.0.1',
    port: 5031,
  })
  return Object.assign(new TypeError('fetch failed'), { cause })
}

function createEngine(options: {
  files: string[]
  importResult: Awaited<ReturnType<DataImporter['importFile']>>
  dataSource: DataSource
  fetchError?: Error
  fetchCalls?: string[]
  isImporting?: (sessionId: string | undefined) => boolean
  fetchParams?: FetchParams[]
  sessionUpdates?: Array<{ sessionId: string; updates: Partial<ImportSession> }>
  pullResults?: Array<{ status: 'success' | 'error'; detail: string }>
  logger?: SyncLogger
}): PullEngine {
  const files = [...options.files]
  const fetcher: HttpFetcher = {
    async fetchToTempFile(
      _baseUrl: string,
      _remoteSessionId: string,
      _token: string,
      params: FetchParams
    ): Promise<string> {
      options.fetchCalls?.push(_remoteSessionId)
      if (options.fetchError) throw options.fetchError
      options.fetchParams?.push({ ...params })
      const file = files.shift()
      if (!file) throw new Error('Unexpected retry fetch')
      return file
    },
  }
  const importer: DataImporter = {
    sessionExists: () => true,
    importFile: async () => options.importResult,
  }
  const notifier: SyncNotifier = {
    onSessionListChanged: () => {},
    onPullResult: (_sourceId, _sessionId, status, detail) => {
      options.pullResults?.push({ status, detail })
    },
  }
  const dsManager = {
    get: () => options.dataSource,
    updateSession: (_sourceId: string, sessionId: string, updates: Partial<ImportSession>) => {
      options.sessionUpdates?.push({ sessionId, updates })
    },
  }

  return new PullEngine({
    fetcher,
    importer,
    notifier,
    dsManager: dsManager as any,
    isImporting: options.isImporting,
    logger: options.logger,
  })
}

describe('PullEngine', () => {
  it('imports a small final page instead of treating it as empty', async () => {
    const session = createSession()
    const dataSource = createDataSource()
    dataSource.sessions = [session]
    const smallFinalPage = writeTempJson({
      chatlab: { version: '0.0.2', exportedAt: 100 },
      meta: { name: 'Test Session', platform: 'test', type: 'group' },
      members: [{ platformId: 'u1', accountName: 'Alice' }],
      messages: [{ sender: 'u1', timestamp: 101, type: 0, content: 'hi' }],
      sync: { hasMore: false, nextSince: 101 },
    })
    let importCount = 0
    const engine = createEngine({
      files: [smallFinalPage],
      dataSource,
      importResult: {
        success: true,
        newMessageCount: 1,
        sessionId: session.targetSessionId,
      },
    })
    ;(engine as any).importer.importFile = async () => {
      importCount++
      return { success: true, newMessageCount: 1, sessionId: session.targetSessionId }
    }

    const result = await withImmediateTimers(() => engine.executePullSession(dataSource.id, dataSource, session))

    assert.equal(result.success, true)
    assert.equal(result.newMessageCount, 1)
    assert.equal(importCount, 1)
  })

  it('does not skip pulls when a different local session is importing', async () => {
    const session = createSession()
    session.targetSessionId = 'local_session_b'
    const dataSource = createDataSource()
    dataSource.sessions = [session]
    const page = writeTempJson({
      chatlab: { version: '0.0.2', exportedAt: 100 },
      meta: { name: 'Test Session', platform: 'test', type: 'group' },
      members: [{ platformId: 'u1', accountName: 'Alice' }],
      messages: [{ sender: 'u1', timestamp: 101, type: 0, content: 'hi' }],
      sync: { hasMore: false, nextSince: 101 },
    })
    const checkedSessionIds: Array<string | undefined> = []
    const engine = createEngine({
      files: [page],
      dataSource,
      isImporting: (sessionId) => {
        checkedSessionIds.push(sessionId)
        return sessionId === 'local_session_a'
      },
      importResult: {
        success: true,
        newMessageCount: 1,
        sessionId: session.targetSessionId,
      },
    })

    const result = await withImmediateTimers(() => engine.executePullSession(dataSource.id, dataSource, session))

    assert.equal(result.success, true)
    assert.equal(result.newMessageCount, 1)
    assert.deepEqual(checkedSessionIds, ['local_session_b'])
  })

  it('keeps the pull cursor stable when an import is deferred by another writer', async () => {
    const session = createSession()
    const dataSource = createDataSource()
    dataSource.sessions = [session]
    const page = writeTempJson({
      chatlab: { version: '0.0.2', exportedAt: 100 },
      meta: { name: 'Test Session', platform: 'test', type: 'group' },
      members: [{ platformId: 'u1', accountName: 'Alice' }],
      messages: [{ sender: 'u1', timestamp: 101, type: 0, content: 'hi' }],
      sync: { hasMore: false, nextSince: 101 },
    })
    const sessionUpdates: Array<{ sessionId: string; updates: Partial<ImportSession> }> = []
    const engine = createEngine({
      files: [page],
      dataSource,
      sessionUpdates,
      importResult: {
        success: false,
        newMessageCount: 0,
        error: 'error.import_in_progress',
        retryable: true,
      },
    })

    const result = await withImmediateTimers(() => engine.executePullSession(dataSource.id, dataSource, session))

    assert.equal(result.success, false)
    assert.equal(result.error, 'error.import_in_progress')
    assert.deepEqual(sessionUpdates, [])
  })

  it('keeps the pull cursor stable when a retry-page import is deferred', async () => {
    const session = createSession()
    const dataSource = createDataSource()
    dataSource.sessions = [session]
    const emptyInitialPage = writeTempJson({
      chatlab: { version: '0.0.2', exportedAt: 100 },
      meta: { name: 'Test Session', platform: 'test', type: 'group' },
      members: [],
      messages: [],
      sync: { hasMore: false, nextSince: 100 },
    })
    const retryPage = writeTempJson({
      chatlab: { version: '0.0.2', exportedAt: 100 },
      meta: { name: 'Test Session', platform: 'test', type: 'group' },
      members: [{ platformId: 'u1', accountName: 'Alice' }],
      messages: [{ sender: 'u1', timestamp: 101, type: 0, content: 'x'.repeat(1200) }],
      sync: { hasMore: false, nextSince: 101 },
    })
    const sessionUpdates: Array<{ sessionId: string; updates: Partial<ImportSession> }> = []
    const engine = createEngine({
      files: [emptyInitialPage, retryPage],
      dataSource,
      sessionUpdates,
      importResult: {
        success: false,
        newMessageCount: 0,
        error: 'error.import_in_progress',
        retryable: true,
      },
    })

    const result = await withImmediateTimers(() => engine.executePullSession(dataSource.id, dataSource, session))

    assert.equal(result.success, false)
    assert.equal(result.error, 'error.import_in_progress')
    assert.deepEqual(sessionUpdates, [])
  })

  it('reports retry import failure instead of marking the pull successful', async () => {
    const session = createSession()
    const dataSource = createDataSource()
    dataSource.sessions = [session]
    const emptyInitialPage = writeTempJson({
      chatlab: { version: '0.0.2', exportedAt: 100 },
      meta: { name: 'Test Session', platform: 'test', type: 'group' },
      members: [],
      messages: [],
      sync: { hasMore: false, nextSince: 100 },
    })
    const retryPage = writeTempJson({
      chatlab: { version: '0.0.2', exportedAt: 100 },
      meta: { name: 'Test Session', platform: 'test', type: 'group' },
      members: [{ platformId: 'u1', accountName: 'Alice' }],
      messages: [
        {
          sender: 'u1',
          timestamp: 101,
          type: 0,
          content: 'x'.repeat(1200),
        },
      ],
      sync: { hasMore: false, nextSince: 101 },
    })
    const emptyTerminalPage = writeTempJson({
      chatlab: { version: '0.0.2', exportedAt: 100 },
      meta: { name: 'Test Session', platform: 'test', type: 'group' },
      members: [],
      messages: [],
      sync: { hasMore: false, nextSince: 101 },
    })
    const emptyRetryPage1 = writeTempJson({
      chatlab: { version: '0.0.2', exportedAt: 100 },
      meta: { name: 'Test Session', platform: 'test', type: 'group' },
      members: [],
      messages: [],
      sync: { hasMore: false, nextSince: 101 },
    })
    const emptyRetryPage2 = writeTempJson({
      chatlab: { version: '0.0.2', exportedAt: 100 },
      meta: { name: 'Test Session', platform: 'test', type: 'group' },
      members: [],
      messages: [],
      sync: { hasMore: false, nextSince: 101 },
    })
    const emptyRetryPage3 = writeTempJson({
      chatlab: { version: '0.0.2', exportedAt: 100 },
      meta: { name: 'Test Session', platform: 'test', type: 'group' },
      members: [],
      messages: [],
      sync: { hasMore: false, nextSince: 101 },
    })
    const sessionUpdates: Array<{ sessionId: string; updates: Partial<ImportSession> }> = []
    const pullResults: Array<{ status: 'success' | 'error'; detail: string }> = []
    const engine = createEngine({
      files: [emptyInitialPage, retryPage, emptyTerminalPage, emptyRetryPage1, emptyRetryPage2, emptyRetryPage3],
      dataSource,
      sessionUpdates,
      pullResults,
      importResult: {
        success: false,
        newMessageCount: 0,
        sessionId: session.targetSessionId,
        error: 'retry import failed',
      },
    })
    const result = await withImmediateTimers(() => engine.executePullSession(dataSource.id, dataSource, session))

    assert.equal(result.success, false)
    assert.equal(result.error, 'retry import failed')
    assert.equal(pullResults.at(-1)?.status, 'error')
    assert.equal(sessionUpdates.at(-1)?.updates.lastStatus, 'error')
  })

  it('continues pagination with nextOffset when nextSince is absent', async () => {
    const session = createSession()
    session.lastPullAt = 0
    const dataSource = createDataSource()
    dataSource.sessions = [session]
    const firstPage = writeTempJson({
      chatlab: { version: '0.0.2', exportedAt: 100 },
      meta: { name: 'Test Session', platform: 'test', type: 'group' },
      members: [{ platformId: 'u1', accountName: 'Alice' }],
      messages: [
        { sender: 'u1', timestamp: 100, type: 0, content: 'page 1a' },
        { sender: 'u1', timestamp: 101, type: 0, content: 'page 1b' },
      ],
      sync: { hasMore: true, nextOffset: 2, watermark: 200 },
    })
    const secondPage = writeTempJson({
      chatlab: { version: '0.0.2', exportedAt: 100 },
      meta: { name: 'Test Session', platform: 'test', type: 'group' },
      members: [{ platformId: 'u1', accountName: 'Alice' }],
      messages: [{ sender: 'u1', timestamp: 200, type: 0, content: 'page 2' }],
      sync: { hasMore: false, watermark: 200 },
    })
    const fetchParams: FetchParams[] = []
    const engine = createEngine({
      files: [firstPage, secondPage],
      dataSource,
      fetchParams,
      importResult: {
        success: true,
        newMessageCount: 1,
        sessionId: session.targetSessionId,
      },
    })

    const result = await withImmediateTimers(() => engine.executePullSession(dataSource.id, dataSource, session))

    assert.equal(result.success, true)
    assert.equal(fetchParams.length, 2)
    assert.equal(fetchParams[0]?.offset, undefined)
    assert.equal(fetchParams[1]?.offset, 2)
  })

  it('persists the imported message cursor with overlap instead of the wall clock', async () => {
    const session = createSession()
    session.lastPullAt = 0
    const dataSource = createDataSource()
    dataSource.sessions = [session]
    const page = writeTempJson({
      chatlab: { version: '0.0.2', exportedAt: 100 },
      meta: { name: 'Test Session', platform: 'test', type: 'group' },
      members: [{ platformId: 'u1', accountName: 'Alice' }],
      messages: [{ sender: 'u1', timestamp: 2000, type: 0, content: 'latest imported message' }],
      sync: { hasMore: false, watermark: 999999 },
    })
    const sessionUpdates: Array<{ sessionId: string; updates: Partial<ImportSession> }> = []
    const engine = createEngine({
      files: [page],
      dataSource,
      sessionUpdates,
      importResult: {
        success: true,
        newMessageCount: 1,
        sessionId: session.targetSessionId,
      },
    })

    const result = await withImmediateTimers(() => engine.executePullSession(dataSource.id, dataSource, session))

    assert.equal(result.success, true)
    assert.equal(sessionUpdates.at(-1)?.updates.lastPullAt, 1940)
  })

  it('persists terminal retry nextSince when it is newer than imported messages', async () => {
    const session = createSession()
    session.lastPullAt = 0
    const dataSource = createDataSource()
    dataSource.sessions = [session]
    const emptyInitialPage = writeTempJson({
      chatlab: { version: '0.0.2', exportedAt: 100 },
      meta: { name: 'Test Session', platform: 'test', type: 'group' },
      members: [],
      messages: [],
      sync: { hasMore: false, nextSince: 100 },
    })
    const terminalRetryPage = writeTempJson({
      chatlab: { version: '0.0.2', exportedAt: 100 },
      meta: { name: 'Test Session', platform: 'test', type: 'group' },
      members: [{ platformId: 'u1', accountName: 'Alice' }],
      messages: [{ sender: 'u1', timestamp: 2000, type: 0, content: 'late retry message' }],
      sync: { hasMore: false, nextSince: 5000 },
    })
    const sessionUpdates: Array<{ sessionId: string; updates: Partial<ImportSession> }> = []
    const engine = createEngine({
      files: [emptyInitialPage, terminalRetryPage],
      dataSource,
      sessionUpdates,
      importResult: {
        success: true,
        newMessageCount: 1,
        sessionId: session.targetSessionId,
      },
    })

    const result = await withImmediateTimers(() => engine.executePullSession(dataSource.id, dataSource, session))

    assert.equal(result.success, true)
    assert.equal(sessionUpdates.at(-1)?.updates.lastPullAt, 4940)
  })

  it('persists terminal retry nextSince from empty retry pages', async () => {
    const session = createSession()
    session.lastPullAt = 0
    const dataSource = createDataSource()
    dataSource.sessions = [session]
    const emptyPages = Array.from({ length: 4 }, () =>
      writeTempJson({
        chatlab: { version: '0.0.2', exportedAt: 100 },
        meta: { name: 'Test Session', platform: 'test', type: 'group' },
        members: [],
        messages: [],
        sync: { hasMore: false, nextSince: 5000 },
      })
    )
    const sessionUpdates: Array<{ sessionId: string; updates: Partial<ImportSession> }> = []
    const engine = createEngine({
      files: emptyPages,
      dataSource,
      sessionUpdates,
      importResult: {
        success: true,
        newMessageCount: 0,
        sessionId: session.targetSessionId,
      },
    })

    const result = await withImmediateTimers(() => engine.executePullSession(dataSource.id, dataSource, session))

    assert.equal(result.success, true)
    assert.equal(result.newMessageCount, 0)
    assert.equal(sessionUpdates.at(-1)?.updates.lastPullAt, 4940)
  })

  it('keeps the pull cursor stable when a successful pull returns no new cursor', async () => {
    const session = createSession()
    session.lastPullAt = 100
    const dataSource = createDataSource()
    dataSource.sessions = [session]
    const emptyPages = Array.from({ length: 4 }, () =>
      writeTempJson({
        chatlab: { version: '0.0.2', exportedAt: 100 },
        meta: { name: 'Test Session', platform: 'test', type: 'group' },
        members: [],
        messages: [],
        sync: { hasMore: false },
      })
    )
    const sessionUpdates: Array<{ sessionId: string; updates: Partial<ImportSession> }> = []
    const engine = createEngine({
      files: emptyPages,
      dataSource,
      sessionUpdates,
      importResult: {
        success: true,
        newMessageCount: 0,
        sessionId: session.targetSessionId,
      },
    })

    const result = await withImmediateTimers(() => engine.executePullSession(dataSource.id, dataSource, session))

    assert.equal(result.success, true)
    assert.equal(result.newMessageCount, 0)
    assert.equal(sessionUpdates.at(-1)?.updates.lastPullAt, 100)
  })

  it('stops the source pull after a network failure and marks remaining sessions failed', async () => {
    const dataSource = createDataSource()
    dataSource.sessions = ['a', 'b', 'c'].map(createSessionWithId)
    const sessionUpdates: Array<{ sessionId: string; updates: Partial<ImportSession> }> = []
    const pullResults: Array<{ status: 'success' | 'error'; detail: string }> = []
    const fetchCalls: string[] = []
    const warns: string[] = []
    const errors: Array<{ message: string; err?: unknown }> = []
    const engine = createEngine({
      files: [],
      dataSource,
      fetchError: createFetchFailedError(),
      fetchCalls,
      sessionUpdates,
      pullResults,
      logger: {
        info: () => {},
        warn: (message) => warns.push(message),
        error: (message, err) => errors.push({ message, err }),
      },
      importResult: {
        success: true,
        newMessageCount: 0,
      },
    })

    await engine.pullAllSessions(dataSource)

    assert.deepEqual(fetchCalls, ['remote_a'])
    assert.equal(warns.length, 1)
    assert.match(warns[0], /Source http:\/\/example\.test\/api\/v1 unavailable: ECONNREFUSED 127\.0\.0\.1:5031/)
    assert.match(warns[0], /skipped 3 sessions/)
    assert.deepEqual(errors, [])
    assert.deepEqual(
      sessionUpdates.map((item) => [item.sessionId, item.updates.lastStatus, item.updates.lastError]),
      [
        ['a', 'error', 'ECONNREFUSED 127.0.0.1:5031'],
        ['b', 'error', 'ECONNREFUSED 127.0.0.1:5031'],
        ['c', 'error', 'ECONNREFUSED 127.0.0.1:5031'],
      ]
    )
    assert.deepEqual(
      pullResults.map((item) => [item.status, item.detail]),
      [
        ['error', 'ECONNREFUSED 127.0.0.1:5031'],
        ['error', 'ECONNREFUSED 127.0.0.1:5031'],
        ['error', 'ECONNREFUSED 127.0.0.1:5031'],
      ]
    )
  })

  it('suppresses repeated source unavailable logs during the cooldown window', async () => {
    const dataSource = createDataSource()
    dataSource.sessions = ['a', 'b'].map(createSessionWithId)
    const warns: string[] = []
    const engine = createEngine({
      files: [],
      dataSource,
      fetchError: createFetchFailedError(),
      logger: {
        info: () => {},
        warn: (message) => warns.push(message),
        error: () => {},
      },
      importResult: {
        success: true,
        newMessageCount: 0,
      },
    })

    await engine.pullAllSessions(dataSource)
    await engine.pullAllSessions(dataSource)

    assert.equal(warns.length, 1)
  })
})
