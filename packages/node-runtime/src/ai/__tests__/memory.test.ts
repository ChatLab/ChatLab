import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import Database from 'better-sqlite3'
import type { AIMemoryEntry, AIMemoryScope } from '@openchatlab/shared-types'
import {
  AI_MEMORY_CONTENT_MAX_CHARS,
  AIMemoryService,
  buildEntityMemoryPrompt,
  buildGlobalMemoryPrompt,
  rankMemoryEntries,
} from '../memory'

const sqliteNativeBinding = process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'chatlab-ai-memory-'))
}

function createService(dir: string, options: { now?: () => number; idFactory?: () => string } = {}): AIMemoryService {
  return new AIMemoryService(dir, {
    ...options,
    nativeBinding: sqliteNativeBinding,
  })
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  } catch {
    // Windows can hold SQLite WAL handles briefly after close; temp cleanup is best-effort.
  }
}

function createMemoryEntry(
  id: string,
  content: string,
  updatedAt: number,
  options: Partial<Pick<AIMemoryEntry, 'scopeType' | 'scopeId' | 'sourceType'>> = {}
): AIMemoryEntry {
  return {
    id,
    scopeType: options.scopeType ?? 'global',
    scopeId: options.scopeId ?? null,
    content,
    sourceType: options.sourceType ?? 'user',
    sourceAIChatId: null,
    sourceMessageId: null,
    createdAt: updatedAt,
    updatedAt,
  }
}

function createVersionOneDatabase(dir: string): void {
  const dbPath = join(dir, 'memory.db')
  const db = sqliteNativeBinding ? new Database(dbPath, { nativeBinding: sqliteNativeBinding }) : new Database(dbPath)
  db.exec(`
    CREATE TABLE ai_memory (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'contact', 'group')),
      scope_id TEXT,
      content TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('user', 'ai')),
      source_ai_chat_id TEXT,
      source_message_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (
        (scope_type = 'global' AND scope_id IS NULL) OR
        (scope_type IN ('contact', 'group') AND scope_id IS NOT NULL)
      )
    );
    CREATE INDEX idx_ai_memory_scope_updated
      ON ai_memory(scope_type, scope_id, updated_at DESC, id ASC);
    INSERT INTO ai_memory (
      id, scope_type, scope_id, content, source_type,
      source_ai_chat_id, source_message_id, created_at, updated_at
    ) VALUES
      ('legacy-global', 'global', NULL, '先给结论', 'user', NULL, NULL, 1, 1),
      ('legacy-contact', 'contact', 'contact-a', '大学同学', 'ai', 'chat-a', NULL, 2, 2);
    PRAGMA user_version = 1;
  `)
  db.close()
}

describe('AIMemoryService', () => {
  it('persists global, self, contact, and group memories across reopen', () => {
    const dir = createTempDir()
    try {
      let id = 0
      const first = createService(dir, {
        now: () => 100,
        idFactory: () => `memory-${++id}`,
      })
      first.create({
        scopeType: 'global',
        scopeId: null,
        content: '最近默认按 90 天计算',
        sourceType: 'user',
        sourceAIChatId: 'chat-1',
      })
      first.create({
        scopeType: 'self',
        scopeId: null,
        content: '用户目前在上海工作',
        sourceType: 'user',
      })
      first.create({
        scopeType: 'contact',
        scopeId: 'contact:qq:10001',
        content: '她是用户的大学同学',
        sourceType: 'user',
      })
      first.create({
        scopeType: 'group',
        scopeId: 'session-group-1',
        content: '截至 2026 年 8 月，该群主要讨论开源项目',
        sourceType: 'ai',
        sourceAIChatId: 'chat-1',
      })
      first.close()

      const reopened = createService(dir)
      assert.deepEqual(
        reopened.list().map((entry) => [entry.id, entry.scopeType, entry.scopeId, entry.sourceType]),
        [
          ['memory-1', 'global', null, 'user'],
          ['memory-2', 'self', null, 'user'],
          ['memory-3', 'contact', 'contact:qq:10001', 'user'],
          ['memory-4', 'group', 'session-group-1', 'ai'],
        ]
      )
      assert.equal(reopened.get('memory-1')?.sourceAIChatId, 'chat-1')
      assert.equal(reopened.getSchemaVersion(), 2)
      reopened.close()
    } finally {
      cleanup(dir)
    }
  })

  it('rejects unpublished legacy schemas instead of carrying compatibility code', () => {
    const dir = createTempDir()
    try {
      createVersionOneDatabase(dir)
      const service = createService(dir)
      assert.throws(() => service.getSchemaVersion(), /Unsupported AI memory schema version: 1/)
      service.close()
    } finally {
      cleanup(dir)
    }
  })

  it('updates by stable id, keeps scope immutable, and sorts deterministically', () => {
    const dir = createTempDir()
    try {
      let now = 100
      let id = 0
      const service = createService(dir, {
        now: () => now,
        idFactory: () => `memory-${++id}`,
      })
      const first = service.create({
        scopeType: 'contact',
        scopeId: 'contact-a',
        content: '旧关系',
        sourceType: 'ai',
      })
      const second = service.create({
        scopeType: 'contact',
        scopeId: 'contact-a',
        content: '另一条背景',
        sourceType: 'user',
      })

      now = 200
      const updated = service.update(first.id, {
        content: '用户已明确纠正为大学同学',
        sourceType: 'user',
        sourceAIChatId: 'chat-2',
      })

      assert.equal(updated.scopeType, 'contact')
      assert.equal(updated.scopeId, 'contact-a')
      assert.equal(updated.createdAt, 100)
      assert.equal(updated.updatedAt, 200)
      assert.deepEqual(
        service.list({ scopeType: 'contact', scopeId: 'contact-a' }).map((entry) => entry.id),
        [first.id, second.id]
      )
      assert.throws(() => service.update('missing', { content: 'x', sourceType: 'user' }), /not found/i)
      service.close()
    } finally {
      cleanup(dir)
    }
  })

  it('forgets and clears only the requested scope', () => {
    const dir = createTempDir()
    try {
      let id = 0
      const service = createService(dir, { idFactory: () => `memory-${++id}` })
      const globalEntry = service.create({
        scopeType: 'global',
        scopeId: null,
        content: '先给结论',
        sourceType: 'user',
      })
      service.create({
        scopeType: 'contact',
        scopeId: 'contact-a',
        content: '联系人 A',
        sourceType: 'user',
      })
      service.create({
        scopeType: 'contact',
        scopeId: 'contact-b',
        content: '联系人 B',
        sourceType: 'user',
      })

      assert.equal(service.forget(globalEntry.id), true)
      assert.equal(service.forget(globalEntry.id), false)
      assert.equal(service.clear({ scopeType: 'contact', scopeId: 'contact-a' }), 1)
      assert.deepEqual(
        service.list().map((entry) => entry.content),
        ['联系人 B']
      )
      assert.equal(service.clear(), 1)
      assert.deepEqual(service.list(), [])
      service.close()
    } finally {
      cleanup(dir)
    }
  })

  it('rejects invalid scopes and invalid content', () => {
    const dir = createTempDir()
    try {
      const service = createService(dir)
      assert.throws(
        () => service.create({ scopeType: 'global', scopeId: 'unexpected', content: 'x', sourceType: 'user' }),
        /scopeId/i
      )
      assert.throws(
        () => service.create({ scopeType: 'self', scopeId: 'unexpected', content: 'x', sourceType: 'user' }),
        /scopeId/i
      )
      assert.throws(
        () => service.create({ scopeType: 'contact', scopeId: null, content: 'x', sourceType: 'user' }),
        /scopeId/i
      )
      assert.throws(
        () => service.create({ scopeType: 'group', scopeId: 'group-a', content: '   ', sourceType: 'user' }),
        /content/i
      )
      assert.throws(
        () =>
          service.create({
            scopeType: 'group',
            scopeId: 'group-a',
            content: 'x'.repeat(AI_MEMORY_CONTENT_MAX_CHARS + 1),
            sourceType: 'ai',
          }),
        /content/i
      )
      service.close()
    } finally {
      cleanup(dir)
    }
  })

  it('supports two service instances without overwriting each other', () => {
    const dir = createTempDir()
    try {
      let id = 0
      const first = createService(dir, { now: () => 100, idFactory: () => `first-${++id}` })
      const second = createService(dir, { now: () => 100, idFactory: () => `second-${++id}` })

      first.create({ scopeType: 'global', scopeId: null, content: 'first', sourceType: 'user' })
      second.create({ scopeType: 'global', scopeId: null, content: 'second', sourceType: 'user' })

      assert.deepEqual(
        first.list().map((entry) => entry.content),
        ['first', 'second']
      )
      assert.deepEqual(
        second.list().map((entry) => entry.content),
        ['first', 'second']
      )
      first.close()
      second.close()
    } finally {
      cleanup(dir)
    }
  })
})

describe('memory relevance ranking', () => {
  it('ranks an older relevant memory ahead of newer unrelated entries', () => {
    const result = rankMemoryEntries(
      [
        createMemoryEntry('newest', '回答尽量简短', 300),
        createMemoryEntry('middle', '优先分析私聊', 200),
        createMemoryEntry('relevant', '用户所说的“最近”默认指最近 90 天', 100),
      ],
      { query: '看看我最近和谁联系最多', locale: 'zh-CN' }
    )

    assert.equal(result.retrievalMode, 'relevance')
    assert.equal(result.matchedCount, 1)
    assert.deepEqual(
      result.entries.map((entry) => entry.id),
      ['relevant', 'newest', 'middle']
    )
  })

  it('falls back to deterministic recent order when the query has no match', () => {
    const result = rankMemoryEntries(
      [
        createMemoryEntry('older', '优先分析私聊', 100),
        createMemoryEntry('newer-b', '先给结论', 200),
        createMemoryEntry('newer-a', '附带证据', 200),
      ],
      { query: '天气怎么样', locale: 'zh-CN' }
    )

    assert.equal(result.retrievalMode, 'recent_fallback')
    assert.equal(result.matchedCount, 0)
    assert.deepEqual(
      result.entries.map((entry) => entry.id),
      ['newer-a', 'newer-b', 'older']
    )
  })

  it('uses user provenance only as a tie-breaker for equally relevant memories', () => {
    const result = rankMemoryEntries(
      [
        createMemoryEntry('ai-newer', '最近默认指 30 天', 200, { sourceType: 'ai' }),
        createMemoryEntry('user-older', '最近默认指 90 天', 100, { sourceType: 'user' }),
      ],
      { query: '最近', locale: 'zh-CN' }
    )

    assert.deepEqual(
      result.entries.map((entry) => entry.id),
      ['user-older', 'ai-newer']
    )
  })

  it('keeps the same retrieval contract across all supported locales', () => {
    const cases = [
      { locale: 'zh-CN', query: '看看最近的联系人', content: '“最近”默认指 90 天' },
      { locale: 'zh-TW', query: '看看最近的聯絡人', content: '「最近」預設指 90 天' },
      { locale: 'en-US', query: 'Please include evidence', content: 'Always include evidence after the conclusion.' },
      { locale: 'ja-JP', query: '最近の連絡先を調べて', content: '「最近」は90日間を意味します' },
    ] as const

    for (const testCase of cases) {
      const result = rankMemoryEntries(
        [
          createMemoryEntry('unrelated', 'Use a concise answer format.', 200),
          createMemoryEntry('relevant', testCase.content, 100),
        ],
        testCase
      )
      assert.equal(result.retrievalMode, 'relevance', testCase.locale)
      assert.equal(result.entries[0]?.id, 'relevant', testCase.locale)
    }
  })

  it('puts an older relevant global preference inside the fixed prompt budget', () => {
    const entries = Array.from({ length: 22 }, (_, index) =>
      createMemoryEntry(`memory-${index}`, `无关偏好 ${index}`, 100 - index)
    )
    entries[21] = createMemoryEntry('relevant', '用户所说的“最近”默认指最近 90 天', 1)

    const prompt = buildGlobalMemoryPrompt(entries, 'zh-CN', '看看我最近和谁联系最多')

    assert.match(prompt, /relevant.*最近 90 天/)
    assert.match(prompt, /部分全局记忆未注入/)
  })

  it('keeps explicit global user preferences when relevant AI memories fill the budget', () => {
    const entries = Array.from({ length: 20 }, (_, index) =>
      createMemoryEntry(`ai-${index}`, `开源项目证据 ${index}`, 200 - index, { sourceType: 'ai' })
    )
    entries.push(createMemoryEntry('user-preference', '回答时始终先给结论', 1, { sourceType: 'user' }))

    const prompt = buildGlobalMemoryPrompt(entries, 'zh-CN', '请分析开源项目证据')

    assert.match(prompt, /user-preference.*先给结论/)
    assert.match(prompt, /ai-0.*开源项目证据/)
    assert.doesNotMatch(prompt, /ai-19/)
  })

  it('reserves prompt capacity for relevance before long baseline preferences', () => {
    const prompt = buildGlobalMemoryPrompt(
      [
        createMemoryEntry('recent-a', '甲'.repeat(2_000), 300),
        createMemoryEntry('recent-b', '乙'.repeat(2_000), 200),
        createMemoryEntry('relevant', '用户所说的“最近”默认指最近 90 天', 100, { sourceType: 'ai' }),
      ],
      'zh-CN',
      '最近按多少天'
    )

    assert.match(prompt, /relevant.*最近 90 天/)
    assert.match(prompt, /recent-a/)
    assert.doesNotMatch(prompt, /recent-b/)
  })

  it('continues scanning for shorter memories when one entry exceeds the remaining character budget', () => {
    const prompt = buildGlobalMemoryPrompt([
      createMemoryEntry('long-a', 'a'.repeat(1_894), 400, { sourceType: 'ai' }),
      createMemoryEntry('long-b', 'b'.repeat(1_894), 300, { sourceType: 'ai' }),
      createMemoryEntry('does-not-fit', 'c'.repeat(506), 200, { sourceType: 'ai' }),
      createMemoryEntry('short', '结论优先', 100, { sourceType: 'ai' }),
    ])

    assert.match(prompt, /long-a/)
    assert.match(prompt, /long-b/)
    assert.doesNotMatch(prompt, /does-not-fit/)
    assert.match(prompt, /short.*结论优先/)
  })

  it('keeps large local candidate sets deterministic without an index', () => {
    const entries = Array.from({ length: 1_000 }, (_, index) =>
      createMemoryEntry(`memory-${String(index).padStart(4, '0')}`, `长期偏好 ${index}`, 1_000 - index)
    )
    entries[999] = createMemoryEntry('relevant', '回答必须附带原始证据', 1)

    const first = rankMemoryEntries(entries, { query: '请附带证据', locale: 'zh-CN' })
    const second = rankMemoryEntries(entries, { query: '请附带证据', locale: 'zh-CN' })

    assert.equal(first.entries.length, 1_000)
    assert.equal(first.entries[0]?.id, 'relevant')
    assert.deepEqual(
      first.entries.map((entry) => entry.id),
      second.entries.map((entry) => entry.id)
    )
  })

  it('does not treat terse normalized content as a reverse substring match', () => {
    const result = rankMemoryEntries(
      [createMemoryEntry('cpp', 'C++', 200), createMemoryEntry('alice', 'Alice is my colleague', 100)],
      { query: 'Who is Alice?', locale: 'en-US' }
    )

    assert.equal(result.retrievalMode, 'relevance')
    assert.equal(result.matchedCount, 1)
    assert.deepEqual(
      result.entries.map((entry) => entry.id),
      ['alice', 'cpp']
    )
  })

  it('matches a symbolic short query without treating its normalized letter as a substring', () => {
    const result = rankMemoryEntries(
      [
        createMemoryEntry('unrelated', 'ChatLab configuration note', 200),
        createMemoryEntry('cpp', 'I prefer C++', 100),
      ],
      { query: 'C++', locale: 'en-US' }
    )

    assert.equal(result.retrievalMode, 'relevance')
    assert.equal(result.matchedCount, 1)
    assert.deepEqual(
      result.entries.map((entry) => entry.id),
      ['cpp', 'unrelated']
    )
  })

  it('retains numeric tokens that distinguish otherwise similar memories', () => {
    const result = rankMemoryEntries(
      [
        createMemoryEntry('port-4000', 'The API runs on port 4000', 200),
        createMemoryEntry('port-3000', 'The API runs on port 3000', 100),
      ],
      { query: 'Should I use port 3000?', locale: 'en-US' }
    )

    assert.equal(result.retrievalMode, 'relevance')
    assert.deepEqual(
      result.entries.map((entry) => entry.id),
      ['port-3000', 'port-4000']
    )
  })
})

describe('entity memory prompt', () => {
  it('injects only current contacts and groups, shares the budget fairly, and ignores private sessions', () => {
    const contactEntries: AIMemoryEntry[] = Array.from({ length: 20 }, (_, index) => ({
      id: `contact-memory-${index}`,
      scopeType: 'contact',
      scopeId: 'contact-a',
      content: `联系人记忆 ${index}`,
      sourceType: index === 0 ? 'ai' : 'user',
      sourceAIChatId: null,
      sourceMessageId: null,
      createdAt: 100 - index,
      updatedAt: 100 - index,
    }))
    const groupEntry: AIMemoryEntry = {
      id: 'group-memory',
      scopeType: 'group',
      scopeId: 'group-a',
      content: '群聊长期背景',
      sourceType: 'user',
      sourceAIChatId: null,
      sourceMessageId: null,
      createdAt: 100,
      updatedAt: 100,
    }
    const requestedScopes: AIMemoryScope[] = []
    const loadEntries = (scope: AIMemoryScope): AIMemoryEntry[] => {
      requestedScopes.push(scope)
      if (scope.scopeType === 'contact' && scope.scopeId === 'contact-a') return contactEntries
      if (scope.scopeType === 'group' && scope.scopeId === 'group-a') return [groupEntry]
      return []
    }

    const prompt = buildEntityMemoryPrompt(
      [
        { type: 'contact', contactKey: 'contact-a', displayName: '小红' },
        { type: 'contact', contactKey: 'contact-a', displayName: '重复选择' },
        { type: 'session', sessionId: 'private-a', displayName: '私聊', sessionType: 'private' },
        { type: 'session', sessionId: 'group-a', displayName: '项目群', sessionType: 'group' },
      ],
      loadEntries,
      'zh-CN'
    )

    assert.deepEqual(requestedScopes, [
      { scopeType: 'contact', scopeId: 'contact-a' },
      { scopeType: 'group', scopeId: 'group-a' },
    ])
    assert.match(prompt, /contact-a.*小红.*contact-memory-0.*source=ai/)
    assert.match(prompt, /group-a.*项目群.*group-memory.*群聊长期背景/)
    assert.match(prompt, /部分当前实体记忆未注入.*memory_read/)
    assert.doesNotMatch(prompt, /private-a/)
  })

  it('rebuilds the prompt from the latest entity refs without retaining the previous contact', () => {
    const entries = new Map<string, AIMemoryEntry[]>([
      [
        'contact:contact-a',
        [
          {
            id: 'memory-a',
            scopeType: 'contact',
            scopeId: 'contact-a',
            content: '只属于联系人 A',
            sourceType: 'user',
            sourceAIChatId: null,
            sourceMessageId: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      ],
      [
        'contact:contact-b',
        [
          {
            id: 'memory-b',
            scopeType: 'contact',
            scopeId: 'contact-b',
            content: '只属于联系人 B',
            sourceType: 'user',
            sourceAIChatId: null,
            sourceMessageId: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      ],
    ])
    const loadEntries = (scope: AIMemoryScope) => entries.get(`${scope.scopeType}:${scope.scopeId}`) ?? []

    const prompt = buildEntityMemoryPrompt(
      [{ type: 'contact', contactKey: 'contact-b', displayName: '联系人 B' }],
      loadEntries,
      'zh-CN'
    )

    assert.match(prompt, /只属于联系人 B/)
    assert.doesNotMatch(prompt, /只属于联系人 A/)
  })

  it('prioritizes relevant memories inside each entity before applying the fair shared budget', () => {
    const entries = Array.from({ length: 21 }, (_, index) =>
      createMemoryEntry(`memory-${index}`, `无关背景 ${index}`, 100 - index, {
        scopeType: 'contact',
        scopeId: 'contact-a',
      })
    )
    entries[20] = createMemoryEntry('relevant', '用户和她曾经一起准备研究生考试', 1, {
      scopeType: 'contact',
      scopeId: 'contact-a',
    })

    const prompt = buildEntityMemoryPrompt(
      [{ type: 'contact', contactKey: 'contact-a', displayName: '联系人 A' }],
      () => entries,
      'zh-CN',
      '我们有没有聊过研究生考试？'
    )

    assert.match(prompt, /relevant.*研究生考试/)
    assert.match(prompt, /部分当前实体记忆未注入/)
  })

  it('keeps recent entity context as fallback for generic relationship questions', () => {
    const prompt = buildEntityMemoryPrompt(
      [{ type: 'contact', contactKey: 'contact-a', displayName: '联系人 A' }],
      () => [
        createMemoryEntry('relationship', '她是用户的大学同学', 100, {
          scopeType: 'contact',
          scopeId: 'contact-a',
        }),
      ],
      'zh-CN',
      '我和她是什么关系？'
    )

    assert.match(prompt, /relationship.*大学同学/)
  })
})
