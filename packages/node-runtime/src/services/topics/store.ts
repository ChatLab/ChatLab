import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseAdapter } from '@openchatlab/core'
import type {
  ChatTopic,
  ChatTopicDay,
  ChatTopicDayStatus,
  ChatTopicRun,
  ChatTopicRunStatus,
} from '@openchatlab/shared-types'
import { openBetterSqliteDatabase } from '../../better-sqlite3-adapter'
import { getChatTopicsDbPath } from './paths'

const CHAT_TOPICS_SCHEMA_VERSION = 2

interface TopicStoreOptions {
  nativeBinding?: string
}

export interface TopicDayCheckpoint {
  sessionId: string
  dayKey: string
  timezone: string
  status: Extract<ChatTopicDayStatus, 'pending' | 'running' | 'failed'>
  sourceSignature: string
  sourceMessageCount: number
  sourceFirstTs: number
  sourceLastTs: number
  runId: string
  totalBlocks: number
  completedBlockIndex: number
  ledgerJson: string
  modelId: string | null
  promptVersion: string
  algorithmVersion: string
  lastError?: string | null
  updatedAt: number
}

export type StoredTopicDayCheckpoint = TopicDayCheckpoint

export interface FinalizeTopicDayInput {
  sessionId: string
  dayKey: string
  timezone: string
  sourceSignature: string
  sourceMessageCount: number
  sourceFirstTs: number
  sourceLastTs: number
  runId: string
  modelId: string | null
  promptVersion: string
  algorithmVersion: string
  overview: string
  topics: ChatTopic[]
  generatedAt: number
}

interface TopicDayRow {
  sessionId: string
  dayKey: string
  timezone: string
  status: ChatTopicDayStatus
  overview: string | null
  sourceSignature: string
  sourceMessageCount: number
  sourceFirstTs: number
  sourceLastTs: number
  modelId: string | null
  promptVersion: string
  algorithmVersion: string
  generatedAt: number | null
  updatedAt: number
}

interface TopicRow {
  id: string
  title: string
  summary: string
  participantsJson: string
  timeRangesJson: string
  assignmentMode: ChatTopic['assignmentMode']
  state: 'active' | 'closed'
}

interface EvidenceRow {
  topicId: string
  messageId: number
  timestamp: number
  role: 'primary' | 'supporting' | 'counter'
}

interface TopicMessageRow {
  topicId: string
  messageId: number
}

interface TopicRunRow {
  id: string
  sessionId: string
  rangeKind: ChatTopicRun['rangeKind']
  timezone: string
  locale: string | null
  startDay: string
  endDay: string
  status: ChatTopicRunStatus
  totalDays: number
  completedDays: number
  totalBlocks: number
  completedBlocks: number
  currentDay: string | null
  currentBlockIndex: number | null
  modelId: string | null
  promptVersion: string
  algorithmVersion: string
  inputTokens: number
  outputTokens: number
  modelCalls: number
  lastError: string | null
  createdAt: number
  updatedAt: number
}

export class ChatTopicStore {
  private readonly db: DatabaseAdapter

  constructor(dbPath: string, options: TopicStoreOptions = {}) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = openBetterSqliteDatabase(dbPath, { nativeBinding: options.nativeBinding })
    this.db.pragma('foreign_keys = ON')
    this.initialize()
  }

  close(): void {
    this.db.close()
  }

  createRun(run: ChatTopicRun): void {
    this.db
      .prepare(
        `INSERT INTO topic_run (
          id, session_id, range_kind, timezone, locale, start_day, end_day, status,
          total_days, completed_days, total_blocks, completed_blocks,
          current_day, current_block_index, model_id, prompt_version, algorithm_version,
          input_tokens, output_tokens, model_calls, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.sessionId,
        run.rangeKind,
        run.timezone,
        run.locale,
        run.startDay,
        run.endDay,
        run.status,
        run.totalDays,
        run.completedDays,
        run.totalBlocks,
        run.completedBlocks,
        run.currentDay,
        run.currentBlockIndex,
        run.modelId,
        run.promptVersion,
        run.algorithmVersion,
        run.inputTokens,
        run.outputTokens,
        run.modelCalls,
        run.lastError,
        run.createdAt,
        run.updatedAt
      )
  }

  updateRun(run: ChatTopicRun): void {
    this.db
      .prepare(
        `UPDATE topic_run SET
          status = ?, total_days = ?, completed_days = ?, total_blocks = ?, completed_blocks = ?,
          current_day = ?, current_block_index = ?,
          model_id = ?, input_tokens = ?, output_tokens = ?, model_calls = ?, last_error = ?, updated_at = ?
        WHERE id = ?`
      )
      .run(
        run.status,
        run.totalDays,
        run.completedDays,
        run.totalBlocks,
        run.completedBlocks,
        run.currentDay,
        run.currentBlockIndex,
        run.modelId,
        run.inputTokens,
        run.outputTokens,
        run.modelCalls,
        run.lastError,
        run.updatedAt,
        run.id
      )
  }

  getRun(runId: string): ChatTopicRun | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id as sessionId, range_kind as rangeKind, timezone, locale,
          start_day as startDay, end_day as endDay, status,
          total_days as totalDays, completed_days as completedDays,
          total_blocks as totalBlocks, completed_blocks as completedBlocks,
          current_day as currentDay, current_block_index as currentBlockIndex,
          model_id as modelId, prompt_version as promptVersion, algorithm_version as algorithmVersion,
          input_tokens as inputTokens, output_tokens as outputTokens, model_calls as modelCalls,
          last_error as lastError, created_at as createdAt, updated_at as updatedAt
        FROM topic_run WHERE id = ?`
      )
      .get(runId) as TopicRunRow | undefined
    return row ?? null
  }

  getLatestRun(sessionId: string): ChatTopicRun | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id as sessionId, range_kind as rangeKind, timezone, locale,
          start_day as startDay, end_day as endDay, status,
          total_days as totalDays, completed_days as completedDays,
          total_blocks as totalBlocks, completed_blocks as completedBlocks,
          current_day as currentDay, current_block_index as currentBlockIndex,
          model_id as modelId, prompt_version as promptVersion, algorithm_version as algorithmVersion,
          input_tokens as inputTokens, output_tokens as outputTokens, model_calls as modelCalls,
          last_error as lastError, created_at as createdAt, updated_at as updatedAt
        FROM topic_run WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(sessionId) as TopicRunRow | undefined
    return row ?? null
  }

  getActiveRun(): ChatTopicRun | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id as sessionId, range_kind as rangeKind, timezone, locale,
          start_day as startDay, end_day as endDay, status,
          total_days as totalDays, completed_days as completedDays,
          total_blocks as totalBlocks, completed_blocks as completedBlocks,
          current_day as currentDay, current_block_index as currentBlockIndex,
          model_id as modelId, prompt_version as promptVersion, algorithm_version as algorithmVersion,
          input_tokens as inputTokens, output_tokens as outputTokens, model_calls as modelCalls,
          last_error as lastError, created_at as createdAt, updated_at as updatedAt
        FROM topic_run
        WHERE status IN ('pending', 'running', 'paused')
        ORDER BY created_at ASC LIMIT 1`
      )
      .get() as TopicRunRow | undefined
    return row ?? null
  }

  recoverInterruptedRuns(updatedAt: number): number {
    return this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE topic_day_work SET status = 'failed', last_error = 'Generation interrupted by application restart', updated_at = ?
           WHERE status IN ('pending', 'running')`
        )
        .run(updatedAt)
      return this.db
        .prepare(
          `UPDATE topic_run SET status = 'paused', last_error = 'Generation interrupted by application restart', updated_at = ?
           WHERE status IN ('pending', 'running')`
        )
        .run(updatedAt).changes
    })
  }

  saveCheckpoint(checkpoint: TopicDayCheckpoint): void {
    this.db
      .prepare(
        `INSERT INTO topic_day_work (
          session_id, day_key, timezone, status, source_signature, source_message_count,
          source_first_ts, source_last_ts, run_id, total_blocks, completed_block_index,
          ledger_json, model_id, prompt_version, algorithm_version, last_error, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, day_key) DO UPDATE SET
          timezone = excluded.timezone,
          status = excluded.status,
          source_signature = excluded.source_signature,
          source_message_count = excluded.source_message_count,
          source_first_ts = excluded.source_first_ts,
          source_last_ts = excluded.source_last_ts,
          run_id = excluded.run_id,
          total_blocks = excluded.total_blocks,
          completed_block_index = excluded.completed_block_index,
          ledger_json = excluded.ledger_json,
          model_id = excluded.model_id,
          prompt_version = excluded.prompt_version,
          algorithm_version = excluded.algorithm_version,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at`
      )
      .run(
        checkpoint.sessionId,
        checkpoint.dayKey,
        checkpoint.timezone,
        checkpoint.status,
        checkpoint.sourceSignature,
        checkpoint.sourceMessageCount,
        checkpoint.sourceFirstTs,
        checkpoint.sourceLastTs,
        checkpoint.runId,
        checkpoint.totalBlocks,
        checkpoint.completedBlockIndex,
        checkpoint.ledgerJson,
        checkpoint.modelId,
        checkpoint.promptVersion,
        checkpoint.algorithmVersion,
        checkpoint.lastError ?? null,
        checkpoint.updatedAt
      )
  }

  getCheckpoint(sessionId: string, dayKey: string): StoredTopicDayCheckpoint | null {
    const row = this.db
      .prepare(
        `SELECT session_id as sessionId, day_key as dayKey, timezone, status,
          source_signature as sourceSignature, source_message_count as sourceMessageCount,
          source_first_ts as sourceFirstTs, source_last_ts as sourceLastTs, run_id as runId,
          total_blocks as totalBlocks, completed_block_index as completedBlockIndex,
          ledger_json as ledgerJson, model_id as modelId, prompt_version as promptVersion,
          algorithm_version as algorithmVersion, last_error as lastError, updated_at as updatedAt
         FROM topic_day_work WHERE session_id = ? AND day_key = ?`
      )
      .get(sessionId, dayKey) as StoredTopicDayCheckpoint | undefined
    return row ?? null
  }

  finalizeDay(input: FinalizeTopicDayInput): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM topic WHERE session_id = ? AND day_key = ?').run(input.sessionId, input.dayKey)

      // 成功快照与进行中的 checkpoint 分离。刷新失败时仍可继续展示上一次成功结果。
      this.db
        .prepare(
          `INSERT INTO topic_day (
            session_id, day_key, timezone, status, overview, source_signature, source_message_count,
            source_first_ts, source_last_ts, run_id, model_id, prompt_version, algorithm_version,
            generated_at, updated_at
          ) VALUES (?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id, day_key) DO UPDATE SET
            timezone = excluded.timezone,
            status = 'ready',
            overview = excluded.overview,
            source_signature = excluded.source_signature,
            source_message_count = excluded.source_message_count,
            source_first_ts = excluded.source_first_ts,
            source_last_ts = excluded.source_last_ts,
            run_id = excluded.run_id,
            model_id = excluded.model_id,
            prompt_version = excluded.prompt_version,
            algorithm_version = excluded.algorithm_version,
            generated_at = excluded.generated_at,
            updated_at = excluded.updated_at`
        )
        .run(
          input.sessionId,
          input.dayKey,
          input.timezone,
          input.overview,
          input.sourceSignature,
          input.sourceMessageCount,
          input.sourceFirstTs,
          input.sourceLastTs,
          input.runId,
          input.modelId,
          input.promptVersion,
          input.algorithmVersion,
          input.generatedAt,
          input.generatedAt
        )

      const insertTopic = this.db.prepare(
        `INSERT INTO topic (
          id, session_id, day_key, ordinal, title, summary, participants_json,
          time_ranges_json, assignment_mode, state, evidence_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const insertEvidence = this.db.prepare(
        `INSERT INTO topic_evidence (topic_id, message_id, timestamp, role)
         VALUES (?, ?, ?, ?)`
      )
      const insertMessage = this.db.prepare(
        `INSERT INTO topic_message (topic_id, message_id)
         VALUES (?, ?)`
      )

      input.topics.forEach((topic, index) => {
        insertTopic.run(
          topic.id,
          input.sessionId,
          input.dayKey,
          index,
          topic.title,
          topic.summary,
          JSON.stringify(topic.participants),
          JSON.stringify(topic.timeRanges),
          topic.assignmentMode,
          topic.state,
          topic.evidence.length
        )
        for (const evidence of topic.evidence) {
          insertEvidence.run(topic.id, evidence.messageId, evidence.timestamp, evidence.role)
        }
        for (const messageId of topic.messageIds) insertMessage.run(topic.id, messageId)
      })

      this.db
        .prepare('DELETE FROM topic_day_work WHERE session_id = ? AND day_key = ?')
        .run(input.sessionId, input.dayKey)
    })
  }

  getDay(sessionId: string, dayKey: string): ChatTopicDay | null {
    const day = this.db
      .prepare(
        `SELECT session_id as sessionId, day_key as dayKey, timezone, status, overview,
          source_signature as sourceSignature, source_message_count as sourceMessageCount,
          source_first_ts as sourceFirstTs, source_last_ts as sourceLastTs,
          model_id as modelId, prompt_version as promptVersion, algorithm_version as algorithmVersion,
          generated_at as generatedAt, updated_at as updatedAt
        FROM topic_day WHERE session_id = ? AND day_key = ?`
      )
      .get(sessionId, dayKey) as TopicDayRow | undefined
    if (!day) return null

    const topicRows = this.db
      .prepare(
        `SELECT id, title, summary, participants_json as participantsJson,
          time_ranges_json as timeRangesJson, assignment_mode as assignmentMode, state
        FROM topic WHERE session_id = ? AND day_key = ? ORDER BY ordinal ASC`
      )
      .all(sessionId, dayKey) as unknown as TopicRow[]
    const evidenceRows = this.db
      .prepare(
        `SELECT e.topic_id as topicId, e.message_id as messageId, e.timestamp, e.role
         FROM topic_evidence e
         JOIN topic t ON t.id = e.topic_id
         WHERE t.session_id = ? AND t.day_key = ?
         ORDER BY e.timestamp ASC, e.message_id ASC`
      )
      .all(sessionId, dayKey) as unknown as EvidenceRow[]
    const messageRows = this.db
      .prepare(
        `SELECT tm.topic_id as topicId, tm.message_id as messageId
         FROM topic_message tm
         JOIN topic t ON t.id = tm.topic_id
         WHERE t.session_id = ? AND t.day_key = ?
         ORDER BY tm.message_id ASC`
      )
      .all(sessionId, dayKey) as unknown as TopicMessageRow[]

    const evidenceByTopic = new Map<string, ChatTopic['evidence']>()
    for (const evidence of evidenceRows) {
      const items = evidenceByTopic.get(evidence.topicId) ?? []
      items.push({ messageId: evidence.messageId, timestamp: evidence.timestamp, role: evidence.role })
      evidenceByTopic.set(evidence.topicId, items)
    }
    const messageIdsByTopic = new Map<string, number[]>()
    for (const message of messageRows) {
      const messageIds = messageIdsByTopic.get(message.topicId) ?? []
      messageIds.push(message.messageId)
      messageIdsByTopic.set(message.topicId, messageIds)
    }

    return {
      ...day,
      lastError: null,
      topics: topicRows.map((topic) => {
        const evidence = evidenceByTopic.get(topic.id) ?? []
        const storedMessageIds = messageIdsByTopic.get(topic.id) ?? []
        return {
          id: topic.id,
          title: topic.title,
          summary: topic.summary,
          participants: parseStringArray(topic.participantsJson),
          timeRanges: parseTimeRanges(topic.timeRangesJson),
          messageIds:
            topic.assignmentMode === 'exact' ? storedMessageIds : [...new Set(evidence.map((item) => item.messageId))],
          assignmentMode: topic.assignmentMode,
          state: topic.state,
          evidence,
        }
      }),
    }
  }

  markDayStale(
    sessionId: string,
    dayKey: string,
    sourceSignature: string,
    timezone: string,
    updatedAt: number
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE topic_day SET status = 'stale', updated_at = ?
         WHERE session_id = ? AND day_key = ? AND status = 'ready'
           AND (source_signature != ? OR timezone != ?)`
      )
      .run(updatedAt, sessionId, dayKey, sourceSignature, timezone)
    return result.changes > 0
  }

  deleteDay(sessionId: string, dayKey: string): boolean {
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM topic WHERE session_id = ? AND day_key = ?').run(sessionId, dayKey)
      const snapshot = this.db
        .prepare('DELETE FROM topic_day WHERE session_id = ? AND day_key = ?')
        .run(sessionId, dayKey).changes
      const work = this.db
        .prepare('DELETE FROM topic_day_work WHERE session_id = ? AND day_key = ?')
        .run(sessionId, dayKey).changes
      return snapshot + work > 0
    })
  }

  deleteSession(sessionId: string): boolean {
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM topic WHERE session_id = ?').run(sessionId)
      const days = this.db.prepare('DELETE FROM topic_day WHERE session_id = ?').run(sessionId).changes
      const work = this.db.prepare('DELETE FROM topic_day_work WHERE session_id = ?').run(sessionId).changes
      const runs = this.db.prepare('DELETE FROM topic_run WHERE session_id = ?').run(sessionId).changes
      return days + work + runs > 0
    })
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS topic_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT OR IGNORE INTO topic_meta (key, value) VALUES ('schema_version', '${CHAT_TOPICS_SCHEMA_VERSION}');
    `)

    const versionRow = this.db.prepare("SELECT value FROM topic_meta WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined
    const version = Number(versionRow?.value)
    if (!Number.isInteger(version) || version < 1 || version > CHAT_TOPICS_SCHEMA_VERSION) {
      throw new Error(`Unsupported chat topics schema version: ${versionRow?.value ?? 'missing'}`)
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS topic_run (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        range_kind TEXT NOT NULL,
        timezone TEXT NOT NULL,
        locale TEXT,
        start_day TEXT NOT NULL,
        end_day TEXT NOT NULL,
        status TEXT NOT NULL,
        total_days INTEGER NOT NULL,
        completed_days INTEGER NOT NULL DEFAULT 0,
        total_blocks INTEGER NOT NULL,
        completed_blocks INTEGER NOT NULL DEFAULT 0,
        current_day TEXT,
        current_block_index INTEGER,
        model_id TEXT,
        prompt_version TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        model_calls INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS topic_day (
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

      CREATE TABLE IF NOT EXISTS topic_day_work (
        session_id TEXT NOT NULL,
        day_key TEXT NOT NULL,
        timezone TEXT NOT NULL,
        status TEXT NOT NULL,
        source_signature TEXT NOT NULL,
        source_message_count INTEGER NOT NULL,
        source_first_ts INTEGER NOT NULL,
        source_last_ts INTEGER NOT NULL,
        run_id TEXT NOT NULL,
        total_blocks INTEGER NOT NULL,
        completed_block_index INTEGER NOT NULL,
        ledger_json TEXT NOT NULL,
        model_id TEXT,
        prompt_version TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        last_error TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, day_key)
      );

      CREATE TABLE IF NOT EXISTS topic (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        day_key TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        participants_json TEXT NOT NULL,
        time_ranges_json TEXT NOT NULL,
        assignment_mode TEXT NOT NULL DEFAULT 'range',
        state TEXT NOT NULL,
        evidence_count INTEGER NOT NULL,
        FOREIGN KEY (session_id, day_key) REFERENCES topic_day(session_id, day_key) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS topic_evidence (
        topic_id TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        role TEXT NOT NULL,
        PRIMARY KEY (topic_id, message_id),
        FOREIGN KEY (topic_id) REFERENCES topic(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_topic_run_session ON topic_run(session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_topic_day_status ON topic_day(session_id, status, day_key);
      CREATE INDEX IF NOT EXISTS idx_topic_day_work_run ON topic_day_work(run_id, day_key);
      CREATE INDEX IF NOT EXISTS idx_topic_day_order ON topic(session_id, day_key, ordinal);
      CREATE INDEX IF NOT EXISTS idx_topic_evidence_message ON topic_evidence(message_id);
    `)

    if (version === 1) {
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE topic ADD COLUMN assignment_mode TEXT NOT NULL DEFAULT 'range';
          CREATE TABLE topic_message (
            topic_id TEXT NOT NULL,
            message_id INTEGER NOT NULL,
            PRIMARY KEY (topic_id, message_id),
            FOREIGN KEY (topic_id) REFERENCES topic(id) ON DELETE CASCADE
          );
          CREATE INDEX idx_topic_message_message ON topic_message(message_id);
        `)
        this.db
          .prepare("UPDATE topic_meta SET value = ? WHERE key = 'schema_version'")
          .run(String(CHAT_TOPICS_SCHEMA_VERSION))
      })
    } else {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS topic_message (
          topic_id TEXT NOT NULL,
          message_id INTEGER NOT NULL,
          PRIMARY KEY (topic_id, message_id),
          FOREIGN KEY (topic_id) REFERENCES topic(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_topic_message_message ON topic_message(message_id);
      `)
    }
  }
}

export function deleteSessionChatTopics(
  userDataDir: string,
  sessionId: string,
  options: TopicStoreOptions = {}
): boolean {
  const dbPath = getChatTopicsDbPath(userDataDir)
  if (!fs.existsSync(dbPath)) return false
  const store = new ChatTopicStore(dbPath, options)
  try {
    return store.deleteSession(sessionId)
  } finally {
    store.close()
  }
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('Invalid topic participants payload')
  }
  return parsed
}

function parseTimeRanges(value: string): ChatTopic['timeRanges'] {
  const parsed = JSON.parse(value) as unknown
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (item) =>
        typeof item !== 'object' ||
        item === null ||
        typeof (item as { startTs?: unknown }).startTs !== 'number' ||
        typeof (item as { endTs?: unknown }).endTs !== 'number'
    )
  ) {
    throw new Error('Invalid topic time ranges payload')
  }
  return parsed as ChatTopic['timeRanges']
}
