import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import type { PathProvider } from '@openchatlab/core'
import { CHAT_DB_SCHEMA } from '@openchatlab/core'
import { DatabaseManager } from '../../database-manager'
import { createDatabaseManagerAdapter } from '../adapters'
import type { ChatTopicModelClient } from './model-client'
import { createChatTopicService, type ChatTopicService } from './service'
import { chatTopicWorkCoordinator } from './work-coordinator'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')
const dayStart = Date.parse('2026-08-08T16:00:00.000Z') / 1000

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-topics-service-'))
}

function createPathProvider(root: string): PathProvider {
  return {
    getSystemDir: () => root,
    getUserDataDir: () => path.join(root, 'data'),
    getDatabaseDir: () => path.join(root, 'data', 'databases'),
    getVectorDir: () => path.join(root, 'data', 'vector'),
    getAiDataDir: () => path.join(root, 'ai'),
    getSettingsDir: () => path.join(root, 'settings'),
    getCacheDir: () => path.join(root, 'cache'),
    getTempDir: () => path.join(root, 'temp'),
    getLogsDir: () => path.join(root, 'logs'),
    getDownloadsDir: () => path.join(root, 'downloads'),
  }
}

function createSession(root: string, messageCount: number, chatType: 'group' | 'private' = 'group'): void {
  const dbDir = path.join(root, 'data', 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const db = new Database(path.join(dbDir, `${chatType}.db`), { nativeBinding })
  db.exec(CHAT_DB_SCHEMA)
  db.prepare(
    `INSERT INTO meta (name, platform, type, imported_at, schema_version)
     VALUES (?, 'wechat', ?, ?, 10)`
  ).run(chatType === 'group' ? 'Test Group' : 'Test Chat', chatType, dayStart)
  db.prepare(
    "INSERT INTO member (id, platform_id, account_name, group_nickname) VALUES (1, 'alice', 'Alice', 'Alice')"
  ).run()
  const insert = db.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, 1, ?, 0, ?)')
  db.transaction(() => {
    for (let index = 1; index <= messageCount; index += 1) {
      insert.run(index, dayStart + 60 + index, `message ${index}`)
    }
  })()
  db.close()
}

function createHarness(
  modelClient: ChatTopicModelClient,
  messageCount: number,
  chatType: 'group' | 'private' = 'group'
): {
  root: string
  service: ChatTopicService
  manager: DatabaseManager
} {
  const root = makeTempDir()
  let nextRunId = 1
  createSession(root, messageCount, chatType)
  const paths = createPathProvider(root)
  const manager = new DatabaseManager(paths, { nativeBinding, allowMissingRuntimeForTests: true })
  const service = createChatTopicService({
    runtime: createDatabaseManagerAdapter(manager),
    userDataDir: paths.getUserDataDir(),
    nativeBinding,
    getModelClient: () => modelClient,
    now: () => Date.parse('2026-08-09T12:00:00.000Z'),
    generateId: () => `run-${nextRunId++}`,
  })
  return { root, service, manager }
}

function successfulTopicResult(prompts: { userPrompt: string }) {
  if (prompts.userPrompt.includes('Block: 1/1')) {
    return {
      text: JSON.stringify({
        operations: [
          {
            operation: 'create',
            localId: 'timezone-topic',
            title: '时区测试',
            summary: '验证时区变化后的重新生成。',
            state: 'active',
            evidence: [{ messageId: 1, timestamp: dayStart + 61, role: 'primary' }],
          },
        ],
        assignments: [{ topicRef: 'timezone-topic', messageIds: [1] }],
      }),
      inputTokens: 1,
      outputTokens: 1,
    }
  }

  const topicId = prompts.userPrompt.match(/topic:[0-9a-f]{24}/)?.[0]
  assert.ok(topicId)
  return {
    text: JSON.stringify({
      overview: '时区测试完成。',
      topics: [{ id: topicId, title: '时区测试', summary: '重新生成完成。', state: 'active' }],
    }),
    inputTokens: 1,
    outputTokens: 1,
  }
}

test('custom topic ranges start on the selected day and stop at an older import cutoff', (t) => {
  const modelClient: ChatTopicModelClient = {
    modelId: 'test/model',
    async complete() {
      throw new Error('preflight must not call the model')
    },
  }
  const { root, service, manager } = createHarness(modelClient, 1)
  t.after(() => {
    service.close()
    manager.closeAll()
  })

  const db = new Database(path.join(root, 'data', 'databases', 'group.db'), { nativeBinding })
  db.prepare('DELETE FROM message').run()
  const insert = db.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, 1, ?, 0, ?)')
  insert.run(1, Date.parse('2026-05-31T16:00:01.000Z') / 1000, 'June 1')
  insert.run(2, Date.parse('2026-06-14T16:00:01.000Z') / 1000, 'June 15')
  db.close()

  const selected = service.preflight('group', {
    rangeKind: 'custom',
    startDay: '2026-06-01',
    timezone: 'Asia/Shanghai',
  })
  assert.equal(selected.startDay, '2026-06-01')
  assert.equal(selected.endDay, '2026-06-15')
  assert.equal(selected.activeDays, 2)
  assert.deepEqual(
    selected.days.map((day) => day.dayKey),
    ['2026-06-01', '2026-06-15']
  )

  const afterCutoff = service.preflight('group', {
    rangeKind: 'custom',
    startDay: '2026-06-16',
    timezone: 'Asia/Shanghai',
  })
  assert.equal(afterCutoff.activeDays, 0)
  assert.equal(afterCutoff.endDay, '2026-06-15')

  assert.throws(
    () => service.preflight('group', { rangeKind: 'custom', timezone: 'Asia/Shanghai' }),
    /start day is required/
  )
})

test('hierarchical topic generation persists validated evidence and marks later imports stale', async () => {
  let calls = 0
  const modelClient: ChatTopicModelClient = {
    modelId: 'test/model',
    async complete(prompts) {
      calls += 1
      if (prompts.userPrompt.includes('Block: 1/2')) {
        return {
          text: JSON.stringify({
            operations: [
              {
                operation: 'create',
                localId: 'daily-thread',
                title: '全天讨论',
                summary: '群聊开始了一项讨论。',
                state: 'active',
                evidence: [{ messageId: 1, timestamp: 999, role: 'primary' }],
              },
            ],
            assignments: [{ topicRef: 'daily-thread', messageIds: [1, 2] }],
          }),
          inputTokens: 10,
          outputTokens: 5,
        }
      }
      const topicId = prompts.userPrompt.match(/topic:[0-9a-f]{24}/)?.[0]
      assert.ok(topicId)
      if (prompts.userPrompt.includes('Block: 2/2')) {
        return {
          text: JSON.stringify({
            operations: [
              {
                operation: 'append',
                topicId,
                summary: '同一讨论延续到了当天后续消息。',
                evidence: [{ messageId: 241, timestamp: 999, role: 'supporting' }],
              },
            ],
            assignments: [{ topicRef: topicId, messageIds: [241] }],
          }),
          inputTokens: 10,
          outputTokens: 5,
        }
      }
      return {
        text: JSON.stringify({
          overview: '今天主要延续了一项讨论。',
          topics: [{ id: topicId, title: '全天讨论', summary: '同一讨论贯穿当天。', state: 'closed' }],
        }),
        inputTokens: 10,
        outputTokens: 5,
      }
    },
  }
  const { root, service, manager } = createHarness(modelClient, 241)

  try {
    const preflight = service.preflight('group', { rangeKind: 'today', timezone: 'Asia/Shanghai' })
    assert.equal(preflight.estimatedBlocks, 2)
    assert.equal(preflight.estimatedCalls, 3)
    const created = service.start('group', {
      rangeKind: 'today',
      timezone: 'Asia/Shanghai',
      locale: 'zh-CN',
    })
    const completed = await waitForRun(service, 'group', created.id, 'completed')
    assert.equal(completed.modelCalls, 3)
    assert.equal(completed.inputTokens, 30)
    assert.equal(calls, 3)

    const day = service.getDay('group', '2026-08-09', 'Asia/Shanghai')
    assert.equal(day?.status, 'ready')
    assert.equal(day?.topics[0]?.state, 'closed')
    assert.deepEqual(
      day?.topics[0]?.evidence.map((evidence) => [evidence.messageId, evidence.timestamp]),
      [
        [1, dayStart + 61],
        [241, dayStart + 301],
      ]
    )
    assert.deepEqual(day?.topics[0]?.messageIds, [1, 2, 241])
    assert.equal(day?.topics[0]?.assignmentMode, 'exact')

    manager.close('group')
    const db = new Database(path.join(root, 'data', 'databases', 'group.db'), { nativeBinding })
    db.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (300, 1, ?, 0, ?)').run(
      dayStart + 400,
      'new message'
    )
    db.close()
    assert.equal(service.getDay('group', '2026-08-09', 'Asia/Shanghai')?.status, 'stale')
  } finally {
    service.close()
    manager.closeAll()
  }
})

test('private conversations use the shared topic runtime with private-chat analysis guidance', async () => {
  let calls = 0
  const modelClient: ChatTopicModelClient = {
    modelId: 'test/model',
    async complete(prompts) {
      calls += 1
      assert.match(prompts.systemPrompt, /private conversation/)
      if (prompts.userPrompt.includes('Block: 1/1')) {
        assert.match(prompts.systemPrompt, /do not infer emotions/)
        return {
          text: JSON.stringify({
            operations: [
              {
                operation: 'create',
                localId: 'interleaved-subject',
                title: '穿插的话题',
                summary: '私聊中的话题在插曲后继续。',
                state: 'active',
                evidence: [{ messageId: 1, timestamp: dayStart + 61, role: 'primary' }],
              },
            ],
            assignments: [{ topicRef: 'interleaved-subject', messageIds: [1] }],
          }),
          inputTokens: 1,
          outputTokens: 1,
        }
      }
      const topicId = prompts.userPrompt.match(/topic:[0-9a-f]{24}/)?.[0]
      assert.ok(topicId)
      return {
        text: JSON.stringify({
          overview: '私聊中有一个持续话题。',
          topics: [{ id: topicId, title: '穿插的话题', summary: '插曲后继续讨论。', state: 'active' }],
        }),
        inputTokens: 1,
        outputTokens: 1,
      }
    },
  }
  const { service, manager } = createHarness(modelClient, 1, 'private')

  try {
    const preflight = service.preflight('private', { rangeKind: 'today', timezone: 'Asia/Shanghai' })
    assert.equal(preflight.activeDays, 1)
    const run = service.start('private', {
      rangeKind: 'today',
      timezone: 'Asia/Shanghai',
      locale: 'zh-CN',
    })
    await waitForRun(service, 'private', run.id, 'completed')
    assert.equal(calls, 2)
    assert.equal(service.getDay('private', '2026-08-09', 'Asia/Shanghai')?.overview, '私聊中有一个持续话题。')
  } finally {
    service.close()
    manager.closeAll()
  }
})

test('range generation does not reuse a ready snapshot from another timezone', async () => {
  const prompts: string[] = []
  const modelClient: ChatTopicModelClient = {
    modelId: 'test/model',
    async complete(prompt) {
      prompts.push(prompt.userPrompt)
      return successfulTopicResult(prompt)
    },
  }
  const { service, manager } = createHarness(modelClient, 1)

  try {
    const first = service.start('group', {
      rangeKind: 'today',
      timezone: 'Asia/Shanghai',
      locale: 'zh-CN',
    })
    await waitForRun(service, 'group', first.id, 'completed')
    const callsAfterFirstRun = prompts.length

    const second = service.start('group', {
      rangeKind: 'today',
      timezone: 'Asia/Tokyo',
      locale: 'zh-CN',
    })
    await waitForRun(service, 'group', second.id, 'completed')

    assert.equal(prompts.length - callsAfterFirstRun, 2)
    const regenerated = service.getDay('group', '2026-08-09', 'Asia/Tokyo')
    assert.equal(regenerated?.timezone, 'Asia/Tokyo')
    assert.equal(regenerated?.status, 'ready')
  } finally {
    service.close()
    manager.closeAll()
  }
})

test('generation does not resume a checkpoint created in another timezone', async () => {
  let failFinalization = true
  let recordPrompts = false
  const resumedPrompts: string[] = []
  const modelClient: ChatTopicModelClient = {
    modelId: 'test/model',
    async complete(prompt) {
      if (recordPrompts) resumedPrompts.push(prompt.userPrompt)
      if (failFinalization && !prompt.userPrompt.includes('Block: 1/1')) {
        return { text: '{}', inputTokens: 1, outputTokens: 1 }
      }
      return successfulTopicResult(prompt)
    },
  }
  const { service, manager } = createHarness(modelClient, 1)

  try {
    const failed = service.generateDay('group', '2026-08-09', 'Asia/Shanghai', 'zh-CN')
    await waitForRun(service, 'group', failed.id, 'failed')

    failFinalization = false
    recordPrompts = true
    const resumed = service.generateDay('group', '2026-08-09', 'Asia/Tokyo', 'zh-CN')
    await waitForRun(service, 'group', resumed.id, 'completed')

    assert.ok(resumedPrompts.some((prompt) => prompt.includes('Block: 1/1')))
    const regenerated = service.getDay('group', '2026-08-09', 'Asia/Tokyo')
    assert.equal(regenerated?.status, 'ready')
  } finally {
    service.close()
    manager.closeAll()
  }
})

test('a paused model request resumes from the persisted day checkpoint', async () => {
  let calls = 0
  const modelClient: ChatTopicModelClient = {
    modelId: 'test/model',
    complete(prompts, options) {
      calls += 1
      if (calls === 1) {
        return new Promise((_, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      }
      if (prompts.userPrompt.includes('Block: 1/1')) {
        return Promise.resolve({
          text: JSON.stringify({
            operations: [
              {
                operation: 'create',
                localId: 'resumed',
                title: '恢复的话题',
                summary: '暂停后恢复。',
                state: 'active',
                evidence: [{ messageId: 1, timestamp: dayStart + 61, role: 'primary' }],
              },
            ],
            assignments: [{ topicRef: 'resumed', messageIds: [1] }],
          }),
          inputTokens: 1,
          outputTokens: 1,
        })
      }
      const topicId = prompts.userPrompt.match(/topic:[0-9a-f]{24}/)?.[0]
      assert.ok(topicId)
      return Promise.resolve({
        text: JSON.stringify({
          overview: '恢复成功。',
          topics: [{ id: topicId, title: '恢复的话题', summary: '暂停后恢复。', state: 'active' }],
        }),
        inputTokens: 1,
        outputTokens: 1,
      })
    },
  }
  const { service, manager } = createHarness(modelClient, 1)

  try {
    const run = service.start('group', { rangeKind: 'today', timezone: 'Asia/Shanghai', locale: 'zh-CN' })
    await waitUntil(() => calls === 1)
    service.pause('group', run.id)
    await waitUntil(() => service.getRun('group', run.id)?.status === 'paused')
    await new Promise<void>((resolve) => setImmediate(resolve))
    service.resume('group', run.id)
    const completed = await waitForRun(service, 'group', run.id, 'completed')
    assert.equal(completed.completedBlocks, 1)
    assert.equal(service.getDay('group', '2026-08-09', 'Asia/Shanghai')?.overview, '恢复成功。')
  } finally {
    service.close()
    manager.closeAll()
  }
})

test('interactive AI work resumes topic generation after another session is deleted', async () => {
  let calls = 0
  const modelClient: ChatTopicModelClient = {
    modelId: 'test/model',
    complete(prompts, options) {
      calls += 1
      if (calls === 1) {
        return new Promise((_, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('preempted')), { once: true })
        })
      }
      if (prompts.userPrompt.includes('Block: 1/1')) {
        return Promise.resolve({
          text: JSON.stringify({
            operations: [
              {
                operation: 'create',
                localId: 'auto-resumed',
                title: '自动恢复',
                summary: '交互式 AI 完成后继续生成。',
                state: 'active',
                evidence: [{ messageId: 1, timestamp: dayStart + 61, role: 'primary' }],
              },
            ],
            assignments: [{ topicRef: 'auto-resumed', messageIds: [1] }],
          }),
          inputTokens: 1,
          outputTokens: 1,
        })
      }
      const topicId = prompts.userPrompt.match(/topic:[0-9a-f]{24}/)?.[0]
      assert.ok(topicId)
      return Promise.resolve({
        text: JSON.stringify({
          overview: '自动恢复完成。',
          topics: [{ id: topicId, title: '自动恢复', summary: '交互优先后继续。', state: 'active' }],
        }),
        inputTokens: 1,
        outputTokens: 1,
      })
    },
  }
  const { service, manager } = createHarness(modelClient, 1)

  try {
    const run = service.start('group', { rangeKind: 'today', timezone: 'Asia/Shanghai', locale: 'zh-CN' })
    await waitUntil(() => calls === 1)
    const release = chatTopicWorkCoordinator.beginInteractiveWork()
    await waitUntil(() => service.getRun('group', run.id)?.status === 'pending')
    await chatTopicWorkCoordinator.prepareSessionDelete('unrelated-session')
    release()
    const completed = await waitForRun(service, 'group', run.id, 'completed')
    assert.equal(completed.modelCalls, 2)
    assert.equal(service.getDay('group', '2026-08-09', 'Asia/Shanghai')?.overview, '自动恢复完成。')
  } finally {
    service.close()
    manager.closeAll()
  }
})

test('session deletion waits for active topic work and removes its derived state', async () => {
  let called = false
  const modelClient: ChatTopicModelClient = {
    modelId: 'test/model',
    complete(_prompts, options) {
      called = true
      return new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('cancelled for deletion')), { once: true })
      })
    },
  }
  const { service, manager } = createHarness(modelClient, 1)

  try {
    const run = service.start('group', { rangeKind: 'today', timezone: 'Asia/Shanghai', locale: 'zh-CN' })
    await waitUntil(() => called)
    await chatTopicWorkCoordinator.prepareSessionDelete('group')
    assert.equal(service.getRun('group', run.id), null)
    assert.equal(service.getLatestRun('group'), null)
  } finally {
    service.close()
    manager.closeAll()
  }
})

async function waitForRun(service: ChatTopicService, sessionId: string, runId: string, status: 'completed' | 'failed') {
  await waitUntil(() => service.getRun(sessionId, runId)?.status === status)
  return service.getRun(sessionId, runId)!
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error('Timed out waiting for chat topic service')
}
