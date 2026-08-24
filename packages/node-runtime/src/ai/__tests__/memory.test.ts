import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import type { AIMemoryEntry, AIMemoryScope } from '@openchatlab/shared-types'
import { AI_MEMORY_CONTENT_MAX_CHARS, AIMemoryService, buildEntityMemoryPrompt } from '../memory'

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

describe('AIMemoryService', () => {
  it('persists global, contact, and group memories across reopen', () => {
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
          ['memory-2', 'contact', 'contact:qq:10001', 'user'],
          ['memory-3', 'group', 'session-group-1', 'ai'],
        ]
      )
      assert.equal(reopened.get('memory-1')?.sourceAIChatId, 'chat-1')
      assert.equal(reopened.getSchemaVersion(), 1)
      reopened.close()
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
})
