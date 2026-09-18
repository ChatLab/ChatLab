/**
 * Benchmark: shared phrases (E01) on a synthetic private chat, with no assertions.
 *
 * Builds an in-memory private chat of mixed Chinese and English messages and times getSharedPhrases through the
 * better-sqlite3 adapter the Node runtime uses and through the sqlite-wasm adapter the Browser Runtime uses (run here
 * in Node, so it measures the SQLite binding, not a browser's JavaScript engine). Prints counts and timings only.
 *
 * Usage:
 *   pnpm exec tsx scripts/bench-shared-phrases.mts [messageCount=5000] [runs=5]
 */

import path from 'node:path'
import { performance } from 'node:perf_hooks'
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { CHAT_DB_SCHEMA, getSharedPhrases, type DatabaseAdapter } from '../packages/core/src/index'
import { openBetterSqliteDatabase } from '../packages/node-runtime/src/better-sqlite3-adapter'
import { SqliteWasmDatabaseAdapter } from '../packages/web-runtime/src/sqlite/adapter'

const messageCount = Number(process.argv[2] ?? 5_000)
const runs = Number(process.argv[3] ?? 5)
const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

const PHRASES = [
  '好的，明天见',
  '哈哈哈哈这也太好笑了',
  '我们周末去吃火锅吧',
  '到家了吗？早点休息',
  '收到，马上来',
  'see you tomorrow',
  'sounds good to me',
  'did you eat yet',
  '今天加班到很晚',
  'miss you 晚安',
  '这个链接你看看 https://example.com/post',
  '[微笑] 没问题',
]
const FILLER = ['嗯', '对', '然后呢', 'ok', 'lol', '真的假的', '可以', 'why not', '在吗', '好累啊']

/** Deterministic PRNG so every run times the same chat. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function populate(db: DatabaseAdapter, count: number): void {
  const random = mulberry32(20260916)
  db.exec(CHAT_DB_SCHEMA)
  db.prepare(
    "INSERT INTO meta (name, platform, type, imported_at, owner_id) VALUES ('Bench', 'weixin', 'private', 0, 'alice')"
  ).run()
  db.prepare("INSERT INTO member (id, platform_id, account_name) VALUES (1, 'alice', 'Alice'), (2, 'bob', 'Bob')").run()
  const insert = db.prepare('INSERT INTO message (sender_id, ts, type, content) VALUES (?, ?, ?, ?)')
  let ts = 1_700_000_000
  let sender = 1
  db.transaction(() => {
    for (let i = 0; i < count; i++) {
      // Mostly short replies inside a session, now and then a pause of hours that starts a new one.
      ts += random() < 0.08 ? 3_600 + Math.floor(random() * 40_000) : 5 + Math.floor(random() * 240)
      if (random() < 0.6) sender = sender === 1 ? 2 : 1
      if (random() < 0.08) {
        insert.run(sender, ts, 1, '[图片]')
        continue
      }
      const pool = random() < 0.45 ? PHRASES : FILLER
      const content = `${pool[Math.floor(random() * pool.length)]}${random() < 0.3 ? ` ${FILLER[i % FILLER.length]}` : ''}`
      insert.run(sender, ts, 0, content)
    }
  })
}

function time(label: string, db: DatabaseAdapter): void {
  const timings: number[] = []
  let summary = ''
  for (let run = 0; run < runs; run++) {
    const startedAt = performance.now()
    const result = getSharedPhrases(db, { limit: 200 })
    timings.push(performance.now() - startedAt)
    if (result.available) {
      summary = `text=${result.coverage.textMessages} excluded=${result.coverage.excludedMessages} turns=${result.coverage.turns} sessions=${result.coverage.sessions} phrases=${result.phrases.length} hasMore=${result.hasMore}`
    }
  }
  const warm = timings.slice(1).sort((a, b) => a - b)
  const median = warm.length > 0 ? warm[Math.floor(warm.length / 2)] : timings[0]
  console.log(
    `${label}: messages=${messageCount} ${summary} first=${timings[0].toFixed(1)}ms median-of-rest=${median.toFixed(1)}ms`
  )
}

const node = openBetterSqliteDatabase(':memory:', { nativeBinding })
populate(node, messageCount)
time('better-sqlite3 (Node runtime)', node)
node.close()

const sqlite3 = await sqlite3InitModule()
const wasm = new SqliteWasmDatabaseAdapter(sqlite3, new sqlite3.oo1.DB(':memory:', 'c'))
populate(wasm, messageCount)
time('sqlite-wasm (Browser Runtime adapter, in Node)', wasm)
wasm.close()

console.log(
  `node=${process.version} icu=${process.versions.icu} rss=${Math.round(process.memoryUsage().rss / 1048576)}MB`
)
