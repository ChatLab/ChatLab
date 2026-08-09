import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import type { ChatTopic, ChatTopicRun } from '@openchatlab/shared-types'
import { getChatTopicsDbPath } from './paths'
import { ChatTopicStore, deleteSessionChatTopics } from './store'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-topics-store-'))
}

function createRun(overrides: Partial<ChatTopicRun> = {}): ChatTopicRun {
  return {
    id: 'run-1',
    sessionId: 'session-1',
    rangeKind: 'today',
    timezone: 'Asia/Shanghai',
    locale: 'zh-CN',
    startDay: '2026-08-09',
    endDay: '2026-08-09',
    status: 'running',
    totalDays: 1,
    completedDays: 0,
    totalBlocks: 2,
    completedBlocks: 0,
    currentDay: '2026-08-09',
    currentBlockIndex: 0,
    modelId: 'test-model',
    promptVersion: 'topics-v1',
    algorithmVersion: 'topics-v1',
    inputTokens: 0,
    outputTokens: 0,
    modelCalls: 0,
    lastError: null,
    createdAt: 1_786_205_000,
    updatedAt: 1_786_205_000,
    ...overrides,
  }
}

function createTopic(): ChatTopic {
  return {
    id: 'session-1:2026-08-09:topic-1',
    title: '周末聚餐',
    summary: '群成员讨论了周末聚餐的时间和地点。',
    participants: ['Alice', 'Bob'],
    timeRanges: [{ startTs: 1_786_205_000, endTs: 1_786_205_600 }],
    messageIds: [10, 11, 12],
    assignmentMode: 'exact',
    state: 'active',
    evidence: [
      { messageId: 10, timestamp: 1_786_205_000, role: 'primary' },
      { messageId: 12, timestamp: 1_786_205_600, role: 'supporting' },
    ],
  }
}

test('successful snapshots stay readable while a newer checkpoint is running', () => {
  const root = makeTempDir()
  const store = new ChatTopicStore(getChatTopicsDbPath(root), { nativeBinding })

  try {
    store.createRun(createRun())
    store.saveCheckpoint({
      sessionId: 'session-1',
      dayKey: '2026-08-09',
      timezone: 'Asia/Shanghai',
      status: 'running',
      sourceSignature: 'signature-v1',
      sourceMessageCount: 20,
      sourceFirstTs: 1_786_205_000,
      sourceLastTs: 1_786_205_600,
      runId: 'run-1',
      totalBlocks: 2,
      completedBlockIndex: 1,
      ledgerJson: '{"topics":[]}',
      modelId: 'test-model',
      promptVersion: 'topics-v1',
      algorithmVersion: 'topics-v1',
      updatedAt: 1_786_205_100,
    })
    store.finalizeDay({
      sessionId: 'session-1',
      dayKey: '2026-08-09',
      timezone: 'Asia/Shanghai',
      sourceSignature: 'signature-v1',
      sourceMessageCount: 20,
      sourceFirstTs: 1_786_205_000,
      sourceLastTs: 1_786_205_600,
      runId: 'run-1',
      modelId: 'test-model',
      promptVersion: 'topics-v1',
      algorithmVersion: 'topics-v1',
      overview: '今天主要讨论了周末安排。',
      topics: [createTopic()],
      generatedAt: 1_786_205_200,
    })

    assert.equal(store.getCheckpoint('session-1', '2026-08-09'), null)
    const storedTopic = store.getDay('session-1', '2026-08-09')?.topics[0]
    assert.equal(storedTopic?.evidence.length, 2)
    assert.deepEqual(storedTopic?.messageIds, [10, 11, 12])
    assert.equal(storedTopic?.assignmentMode, 'exact')

    store.saveCheckpoint({
      sessionId: 'session-1',
      dayKey: '2026-08-09',
      timezone: 'Asia/Shanghai',
      status: 'running',
      sourceSignature: 'signature-v2',
      sourceMessageCount: 21,
      sourceFirstTs: 1_786_205_000,
      sourceLastTs: 1_786_206_000,
      runId: 'run-2',
      totalBlocks: 2,
      completedBlockIndex: 0,
      ledgerJson: '{"topics":[]}',
      modelId: 'test-model',
      promptVersion: 'topics-v1',
      algorithmVersion: 'topics-v1',
      updatedAt: 1_786_206_100,
    })

    assert.equal(store.getDay('session-1', '2026-08-09')?.overview, '今天主要讨论了周末安排。')
    assert.equal(store.getCheckpoint('session-1', '2026-08-09')?.sourceSignature, 'signature-v2')
  } finally {
    store.close()
  }
})

test('source or timezone changes mark a ready day stale without discarding its topics', () => {
  const root = makeTempDir()
  const store = new ChatTopicStore(getChatTopicsDbPath(root), { nativeBinding })

  try {
    store.createRun(createRun())
    const snapshot = {
      sessionId: 'session-1',
      dayKey: '2026-08-09',
      timezone: 'Asia/Shanghai',
      sourceSignature: 'signature-v1',
      sourceMessageCount: 20,
      sourceFirstTs: 1_786_205_000,
      sourceLastTs: 1_786_205_600,
      runId: 'run-1',
      modelId: 'test-model',
      promptVersion: 'topics-v1',
      algorithmVersion: 'topics-v1',
      overview: '旧快照',
      topics: [createTopic()],
      generatedAt: 1_786_205_200,
    }
    store.finalizeDay(snapshot)

    assert.equal(store.markDayStale('session-1', '2026-08-09', 'signature-v1', 'Asia/Shanghai', 1_786_205_300), false)
    assert.equal(store.markDayStale('session-1', '2026-08-09', 'signature-v1', 'UTC', 1_786_205_350), true)
    assert.equal(store.getDay('session-1', '2026-08-09')?.status, 'stale')

    store.finalizeDay({ ...snapshot, sourceSignature: 'signature-v1', generatedAt: 1_786_205_375 })
    assert.equal(store.markDayStale('session-1', '2026-08-09', 'signature-v2', 'Asia/Shanghai', 1_786_205_400), true)
    assert.equal(store.getDay('session-1', '2026-08-09')?.status, 'stale')
    assert.equal(store.getDay('session-1', '2026-08-09')?.topics[0]?.title, '周末聚餐')
  } finally {
    store.close()
  }
})

test('deleting a session removes its snapshots, checkpoints and runs only', () => {
  const root = makeTempDir()
  const dbPath = getChatTopicsDbPath(root)
  const store = new ChatTopicStore(dbPath, { nativeBinding })

  try {
    store.createRun(createRun())
    store.createRun(createRun({ id: 'run-2', sessionId: 'session-2' }))
    store.saveCheckpoint({
      sessionId: 'session-1',
      dayKey: '2026-08-09',
      timezone: 'Asia/Shanghai',
      status: 'failed',
      sourceSignature: 'signature-v1',
      sourceMessageCount: 20,
      sourceFirstTs: 1_786_205_000,
      sourceLastTs: 1_786_205_600,
      runId: 'run-1',
      totalBlocks: 2,
      completedBlockIndex: 1,
      ledgerJson: '{"topics":[]}',
      modelId: 'test-model',
      promptVersion: 'topics-v1',
      algorithmVersion: 'topics-v1',
      updatedAt: 1_786_205_100,
    })
  } finally {
    store.close()
  }

  assert.equal(deleteSessionChatTopics(root, 'session-1', { nativeBinding }), true)

  const reopened = new ChatTopicStore(dbPath, { nativeBinding })
  try {
    assert.equal(reopened.getRun('run-1'), null)
    assert.equal(reopened.getCheckpoint('session-1', '2026-08-09'), null)
    assert.notEqual(reopened.getRun('run-2'), null)
  } finally {
    reopened.close()
  }
})

test('schema v1 snapshots migrate without losing their legacy range fallback', () => {
  const root = makeTempDir()
  const dbPath = getChatTopicsDbPath(root)
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath, { nativeBinding })
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE topic_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO topic_meta (key, value) VALUES ('schema_version', '1');
    CREATE TABLE topic_day (
      session_id TEXT NOT NULL,
      day_key TEXT NOT NULL,
      timezone TEXT NOT NULL,
      status TEXT NOT NULL,
      overview TEXT,
      source_signature TEXT NOT NULL,
      source_message_count INTEGER NOT NULL,
      source_first_ts INTEGER NOT NULL,
      source_last_ts INTEGER NOT NULL,
      run_id TEXT NOT NULL,
      model_id TEXT,
      prompt_version TEXT NOT NULL,
      algorithm_version TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, day_key)
    );
    CREATE TABLE topic (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      day_key TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      participants_json TEXT NOT NULL,
      time_ranges_json TEXT NOT NULL,
      state TEXT NOT NULL,
      evidence_count INTEGER NOT NULL,
      FOREIGN KEY (session_id, day_key) REFERENCES topic_day(session_id, day_key) ON DELETE CASCADE
    );
    CREATE TABLE topic_evidence (
      topic_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (topic_id, message_id),
      FOREIGN KEY (topic_id) REFERENCES topic(id) ON DELETE CASCADE
    );
    INSERT INTO topic_day VALUES (
      'session-1', '2026-08-09', 'Asia/Shanghai', 'ready', '旧快照', 'signature-v1',
      3, 100, 300, 'run-1', 'model', 'topics-v1', 'topics-v1', 400, 400
    );
    INSERT INTO topic VALUES (
      'topic-1', 'session-1', '2026-08-09', 0, '旧话题', '旧摘要', '["Alice"]',
      '[{"startTs":100,"endTs":300}]', 'closed', 2
    );
    INSERT INTO topic_evidence VALUES ('topic-1', 10, 100, 'primary');
    INSERT INTO topic_evidence VALUES ('topic-1', 12, 300, 'supporting');
  `)
  db.close()

  const store = new ChatTopicStore(dbPath, { nativeBinding })
  try {
    const topic = store.getDay('session-1', '2026-08-09')?.topics[0]
    assert.equal(topic?.assignmentMode, 'range')
    assert.deepEqual(topic?.messageIds, [10, 12])
    const migrated = new Database(dbPath, { nativeBinding })
    try {
      assert.equal(migrated.prepare("SELECT value FROM topic_meta WHERE key = 'schema_version'").pluck().get(), '2')
    } finally {
      migrated.close()
    }
  } finally {
    store.close()
  }
})
