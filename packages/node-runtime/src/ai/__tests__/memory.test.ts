import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { AI_MEMORY_CONTENT_MAX_CHARS, AIMemoryService } from '../memory'

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
