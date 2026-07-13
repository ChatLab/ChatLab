import assert from 'node:assert/strict'
import test from 'node:test'
import { hashImportBody, ImportIdempotencyCache } from './import-idempotency'

test('replays a successful response for the same key and body hash', () => {
  const cache = new ImportIdempotencyCache<{ ok: boolean }>()
  const hash = hashImportBody({ messages: [1] })

  assert.deepEqual(cache.start('session:key', hash, 100), { status: 'started' })
  assert.deepEqual(cache.start('session:key', hash, 101), { status: 'pending' })

  cache.success('session:key', { ok: true })
  assert.deepEqual(cache.start('session:key', hash, 102), {
    status: 'success',
    response: { ok: true },
  })
})

test('reports conflicts and releases failed requests for retry', () => {
  const cache = new ImportIdempotencyCache<string>()
  const firstHash = hashImportBody({ messages: ['first'] })
  const secondHash = hashImportBody({ messages: ['second'] })

  assert.deepEqual(cache.start('session:key', firstHash, 100), { status: 'started' })
  assert.deepEqual(cache.start('session:key', secondHash, 101), { status: 'conflict' })

  cache.fail('session:key')
  assert.deepEqual(cache.start('session:key', secondHash, 102), { status: 'started' })
})

test('expires stale entries lazily', () => {
  const cache = new ImportIdempotencyCache<string>(10)
  const firstHash = hashImportBody({ messages: ['first'] })
  const secondHash = hashImportBody({ messages: ['second'] })

  assert.deepEqual(cache.start('session:key', firstHash, 100), { status: 'started' })
  assert.deepEqual(cache.start('session:key', secondHash, 111), { status: 'started' })
})
