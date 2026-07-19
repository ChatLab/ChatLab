import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import type { DatabaseAdapter } from '@openchatlab/core'
import { initSync as initParserWasm } from '../src/wasm/generated/parser_native.js'
import { SqliteWasmDatabaseAdapter } from '../src/sqlite/adapter'
import {
  parseBrowserImportSource,
  type BrowserImportFormatId,
  type BrowserParseSource,
} from '../src/import/browser-parser'
import {
  BrowserSessionRuntime,
  sessionDatabaseFilename,
  type WorkspaceDatabasePort,
} from '../src/import/session-runtime'

const MESSAGE_COUNT = 100_000
const MEMBER_COUNT = 50
const BASE_TIMESTAMP = 1_700_000_000

initParserWasm({
  module: new Uint8Array(readFileSync(new URL('../src/wasm/generated/parser_native_bg.wasm', import.meta.url))),
})

interface BenchmarkFixture {
  label: string
  formatId: BrowserImportFormatId
  source: BrowserParseSource
  firstContent: string
  lastContent: string
  firstTimestamp: number
  lastTimestamp: number
  chatIndex?: number
}

class MemoryWorkspaceDatabase implements WorkspaceDatabasePort {
  private readonly databases = new Map<string, { raw: Database; adapter: SqliteWasmDatabaseAdapter }>()

  constructor(private readonly sqlite3: Sqlite3Static) {}

  async withDatabase<T>(filename: string, schemaSql: string, operation: (db: DatabaseAdapter) => T): Promise<T> {
    let entry = this.databases.get(filename)
    if (!entry) {
      const raw = new this.sqlite3.oo1.DB(':memory:', 'c')
      entry = { raw, adapter: new SqliteWasmDatabaseAdapter(this.sqlite3, raw) }
      this.databases.set(filename, entry)
    }
    entry.adapter.exec(schemaSql)
    return operation(entry.adapter)
  }

  async deleteDatabase(filename: string): Promise<boolean> {
    const entry = this.databases.get(filename)
    if (!entry) return false
    entry.adapter.close()
    this.databases.delete(filename)
    return true
  }

  async ensureCapacity(_minimum: number): Promise<number> {
    return 32
  }

  async getDatabaseFilenames(): Promise<string[]> {
    return [...this.databases.keys()]
  }

  getDatabase(filename: string): DatabaseAdapter | undefined {
    return this.databases.get(filename)?.adapter
  }

  dispose(): void {
    for (const entry of this.databases.values()) entry.adapter.close()
    this.databases.clear()
  }
}

function createChatLabFixture(): BenchmarkFixture {
  const lines: string[] = [
    JSON.stringify({
      _type: 'header',
      chatlab: { version: '1', exportedAt: BASE_TIMESTAMP },
      meta: { name: 'Web runtime large fixture', platform: 'wechat', type: 'group', ownerId: 'member-0' },
    }),
  ]
  for (let index = 0; index < MEMBER_COUNT; index += 1) {
    lines.push(
      JSON.stringify({
        _type: 'member',
        platformId: `member-${index}`,
        accountName: `Member ${index}`,
      })
    )
  }
  for (let index = 0; index < MESSAGE_COUNT; index += 1) {
    const member = index % MEMBER_COUNT
    lines.push(
      JSON.stringify({
        _type: 'message',
        sender: `member-${member}`,
        accountName: `Member ${member}`,
        timestamp: BASE_TIMESTAMP + index,
        type: 0,
        content: `fixture-message-${index}`,
        platformMessageId: `fixture-${index}`,
      })
    )
  }

  const blob = new Blob([lines.join('\n')], { type: 'application/x-ndjson' })
  return {
    label: 'ChatLab JSONL',
    formatId: 'chatlab-jsonl',
    source: blobSource('web-runtime-large-fixture.jsonl', blob),
    firstContent: 'fixture-message-0',
    lastContent: `fixture-message-${MESSAGE_COUNT - 1}`,
    firstTimestamp: BASE_TIMESTAMP,
    lastTimestamp: BASE_TIMESTAMP + MESSAGE_COUNT - 1,
  }
}

function createChatLabJsonFixture(): BenchmarkFixture {
  const members = Array.from({ length: MEMBER_COUNT }, (_, index) => ({
    platformId: `member-${index}`,
    accountName: `Member ${index}`,
  }))
  const messages = Array.from({ length: MESSAGE_COUNT }, (_, index) => {
    const member = index % MEMBER_COUNT
    return {
      sender: `member-${member}`,
      accountName: `Member ${member}`,
      timestamp: BASE_TIMESTAMP + index,
      type: 0,
      content: `fixture-message-${index}`,
      platformMessageId: `fixture-${index}`,
    }
  })
  const blob = new Blob([
    JSON.stringify({
      chatlab: { version: '1', exportedAt: BASE_TIMESTAMP },
      meta: { name: 'Web runtime ChatLab JSON fixture', platform: 'wechat', type: 'group', ownerId: 'member-0' },
      members,
      messages,
    }),
  ])
  return {
    label: 'ChatLab JSON (Rust WASM)',
    formatId: 'chatlab',
    source: blobSource('web-runtime-chatlab-wasm.json', blob),
    firstContent: 'fixture-message-0',
    lastContent: `fixture-message-${MESSAGE_COUNT - 1}`,
    firstTimestamp: BASE_TIMESTAMP,
    lastTimestamp: BASE_TIMESTAMP + MESSAGE_COUNT - 1,
  }
}

function createWeFlowFixture(): BenchmarkFixture {
  const messages = Array.from({ length: MESSAGE_COUNT }, (_, index) => {
    const member = index % MEMBER_COUNT
    return {
      localId: index + 1,
      createTime: BASE_TIMESTAMP + index,
      type: '文本消息',
      content: `fixture-message-${index}`,
      isSend: index === 0 ? 1 : 0,
      senderUsername: `member-${member}`,
      senderDisplayName: `Member ${member}`,
      senderAvatarKey: `member-${member}`,
    }
  })
  const blob = new Blob([
    JSON.stringify({
      weflow: { version: '1', exportedAt: BASE_TIMESTAMP },
      session: {
        wxid: 'benchmark@chatroom',
        displayName: 'Web runtime WeFlow fixture',
        type: '群聊',
      },
      messages,
    }),
  ])
  return {
    label: 'WeFlow JSON (Rust WASM)',
    formatId: 'weflow',
    source: blobSource('web-runtime-weflow-wasm.json', blob),
    firstContent: 'fixture-message-0',
    lastContent: `fixture-message-${MESSAGE_COUNT - 1}`,
    firstTimestamp: BASE_TIMESTAMP,
    lastTimestamp: BASE_TIMESTAMP + MESSAGE_COUNT - 1,
  }
}

function createWhatsAppFixture(): BenchmarkFixture {
  const baseDate = new Date(2024, 0, 1, 0, 0, 0)
  const firstTimestamp = Math.floor(baseDate.getTime() / 1000)
  const lines = ['Messages and calls are end-to-end encrypted.']
  for (let index = 0; index < MESSAGE_COUNT; index += 1) {
    const timestamp = new Date((firstTimestamp + index) * 1000)
    lines.push(`${formatWhatsAppTimestamp(timestamp)} - Member ${index % MEMBER_COUNT}: fixture-message-${index}`)
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
  return {
    label: 'WhatsApp TXT',
    formatId: 'whatsapp-native-txt',
    source: blobSource('WhatsApp benchmark.txt', blob),
    firstContent: 'fixture-message-0',
    lastContent: `fixture-message-${MESSAGE_COUNT - 1}`,
    firstTimestamp,
    lastTimestamp: firstTimestamp + MESSAGE_COUNT - 1,
  }
}

function createLineFixture(): BenchmarkFixture {
  const baseDate = new Date(2024, 0, 2, 0, 0, 0)
  const firstTimestamp = Math.floor(baseDate.getTime() / 1000)
  const lastTimestamp = firstTimestamp + (24 * 60 - 1) * 60
  const lines = ['[LINE] Chat history in Benchmark Team', 'Saved on: 2024/01/03 09:00', '', '2024.01.02 Tuesday']
  for (let index = 0; index < MESSAGE_COUNT; index += 1) {
    const minute = index === MESSAGE_COUNT - 1 ? 24 * 60 - 1 : index % (24 * 60 - 1)
    lines.push(`${formatLineTime(minute)}\tMember ${index % MEMBER_COUNT}\tfixture-message-${index}`)
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
  return {
    label: 'LINE TXT',
    formatId: 'line-native-txt',
    source: blobSource('[LINE] Benchmark Team.txt', blob),
    firstContent: 'fixture-message-0',
    lastContent: `fixture-message-${MESSAGE_COUNT - 1}`,
    firstTimestamp,
    lastTimestamp,
  }
}

function createQqFixture(): BenchmarkFixture {
  const baseDate = new Date(2024, 0, 3, 0, 0, 0)
  const firstTimestamp = Math.floor(baseDate.getTime() / 1000)
  const lines = ['消息记录（此消息记录为文本格式，不支持重新导入）', '消息对象:Benchmark Team']
  for (let index = 0; index < MESSAGE_COUNT; index += 1) {
    const timestamp = new Date((firstTimestamp + index) * 1000)
    const member = index % MEMBER_COUNT
    lines.push(`${formatQqTimestamp(timestamp)} Member ${member}(${20_000 + member})`, `fixture-message-${index}`)
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
  return {
    label: 'QQ TXT',
    formatId: 'qq-native-txt',
    source: blobSource('qq-benchmark.txt', blob),
    firstContent: 'fixture-message-0',
    lastContent: `fixture-message-${MESSAGE_COUNT - 1}`,
    firstTimestamp,
    lastTimestamp: firstTimestamp + MESSAGE_COUNT - 1,
  }
}

function createTelegramFixture(): BenchmarkFixture {
  const messages = Array.from({ length: MESSAGE_COUNT }, (_, index) => {
    const member = index % MEMBER_COUNT
    return {
      id: index + 1,
      type: 'message',
      date: '2024-01-04T00:00:00',
      date_unixtime: String(BASE_TIMESTAMP + index),
      from: `Member ${member}`,
      from_id: `user${20_000 + member}`,
      text: `fixture-message-${index}`,
    }
  })
  const blob = new Blob(
    [
      JSON.stringify({
        name: 'Benchmark Team',
        type: 'private_group',
        id: 4242,
        messages,
      }),
    ],
    { type: 'application/json' }
  )
  return {
    label: 'Telegram single-chat JSON',
    formatId: 'telegram-native-single',
    source: blobSource('telegram-benchmark.json', blob),
    firstContent: 'fixture-message-0',
    lastContent: `fixture-message-${MESSAGE_COUNT - 1}`,
    firstTimestamp: BASE_TIMESTAMP,
    lastTimestamp: BASE_TIMESTAMP + MESSAGE_COUNT - 1,
  }
}

function createTelegramFullFixture(): BenchmarkFixture {
  const messages = Array.from({ length: MESSAGE_COUNT }, (_, index) => {
    const member = index % MEMBER_COUNT
    return {
      id: index + 1,
      type: 'message',
      date: '2024-01-04T00:00:00',
      date_unixtime: String(BASE_TIMESTAMP + index),
      from: `Member ${member}`,
      from_id: `user${20_000 + member}`,
      text: `fixture-message-${index}`,
    }
  })
  const blob = new Blob(
    [
      JSON.stringify({
        about: 'This file was exported by Telegram Desktop.',
        chats: {
          list: [
            { name: 'Empty Chat', type: 'personal_chat', id: 1, messages: [] },
            { name: 'Benchmark Team', type: 'private_group', id: 4242, messages },
          ],
        },
      }),
    ],
    { type: 'application/json' }
  )
  return {
    label: 'Telegram full export JSON',
    formatId: 'telegram-native',
    source: blobSource('telegram-full-benchmark.json', blob),
    firstContent: 'fixture-message-0',
    lastContent: `fixture-message-${MESSAGE_COUNT - 1}`,
    firstTimestamp: BASE_TIMESTAMP,
    lastTimestamp: BASE_TIMESTAMP + MESSAGE_COUNT - 1,
    chatIndex: 1,
  }
}

function blobSource(name: string, blob: Blob): BrowserParseSource {
  return {
    name,
    size: blob.size,
    type: blob.type,
    text: () => blob.text(),
    arrayBuffer: () => blob.arrayBuffer(),
    slice: (start?: number, end?: number) => blob.slice(start, end),
  }
}

function formatWhatsAppTimestamp(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${value.getFullYear()}/${pad(value.getMonth() + 1)}/${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
}

function formatLineTime(minute: number): string {
  const hours = Math.floor(minute / 60)
  const minutes = minute % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function formatQqTimestamp(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
}

function createFixture(kind: string | undefined): BenchmarkFixture {
  if (kind === 'chatlab-json') return createChatLabJsonFixture()
  if (kind === 'weflow') return createWeFlowFixture()
  if (kind === 'whatsapp') return createWhatsAppFixture()
  if (kind === 'line') return createLineFixture()
  if (kind === 'qq') return createQqFixture()
  if (kind === 'telegram') return createTelegramFixture()
  if (kind === 'telegram-full') return createTelegramFullFixture()
  return createChatLabFixture()
}

const sqlite3 = await sqlite3InitModule()
const database = new MemoryWorkspaceDatabase(sqlite3)
const runtime = new BrowserSessionRuntime(database, {
  createSessionId: () => 'large-fixture-session',
  now: () => BASE_TIMESTAMP,
})
const fixture = createFixture(process.argv[2])

try {
  let scanElapsedMs: number | undefined
  let parseElapsedMs: number | undefined
  if (fixture.formatId === 'telegram-native') {
    const scanStartedAt = performance.now()
    const chats = await runtime.scanMultiChatSource(fixture.source)
    scanElapsedMs = performance.now() - scanStartedAt
    assert.deepEqual(
      chats.map((chat) => ({ index: chat.index, messageCount: chat.messageCount })),
      [
        { index: 0, messageCount: 0 },
        { index: 1, messageCount: MESSAGE_COUNT },
      ]
    )
  }
  if (fixture.formatId === 'chatlab' || fixture.formatId === 'weflow') {
    const parseStartedAt = performance.now()
    const parsed = await parseBrowserImportSource(fixture.source, { formatId: fixture.formatId })
    parseElapsedMs = performance.now() - parseStartedAt
    assert.equal(parsed.messages.length, MESSAGE_COUNT)
    assert.equal(parsed.members.length, MEMBER_COUNT)
    assert.equal(parsed.messages[0]?.content, fixture.firstContent)
    assert.equal(parsed.messages.at(-1)?.content, fixture.lastContent)
  }
  const startedAt = performance.now()
  const result = await runtime.importSource(fixture.source, {
    formatId: fixture.formatId,
    chatIndex: fixture.chatIndex,
  })
  const elapsedMs = performance.now() - startedAt
  const sessions = await runtime.listSessions()
  const sessionDb = database.getDatabase(sessionDatabaseFilename(result.sessionId))
  assert.ok(sessionDb)

  const counts = sessionDb.prepare('SELECT COUNT(*) AS count FROM message').get() as { count: number }
  const members = sessionDb.prepare('SELECT COUNT(*) AS count FROM member').get() as { count: number }
  const first = sessionDb.prepare('SELECT content, ts FROM message ORDER BY id ASC LIMIT 1').get()
  const last = sessionDb.prepare('SELECT content, ts FROM message ORDER BY id DESC LIMIT 1').get()

  assert.equal(result.messageCount, MESSAGE_COUNT)
  assert.equal(result.memberCount, MEMBER_COUNT)
  assert.equal(counts.count, MESSAGE_COUNT)
  assert.equal(members.count, MEMBER_COUNT)
  assert.deepEqual(first, { content: fixture.firstContent, ts: fixture.firstTimestamp })
  assert.deepEqual(last, {
    content: fixture.lastContent,
    ts: fixture.lastTimestamp,
  })
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0]?.messageCount, MESSAGE_COUNT)
  assert.equal(sessions[0]?.lastMessageTs, fixture.lastTimestamp)

  console.log(
    JSON.stringify(
      {
        fixture: fixture.label,
        fixtureBytes: fixture.source.size,
        messages: MESSAGE_COUNT,
        members: MEMBER_COUNT,
        elapsedMs: Number(elapsedMs.toFixed(1)),
        parseElapsedMs: parseElapsedMs === undefined ? undefined : Number(parseElapsedMs.toFixed(1)),
        scanElapsedMs: scanElapsedMs === undefined ? undefined : Number(scanElapsedMs.toFixed(1)),
        rowsPerSecond: Math.round(MESSAGE_COUNT / (elapsedMs / 1000)),
        correctness: 'passed',
        persistence: 'not measured (in-memory VFS)',
      },
      null,
      2
    )
  )
} finally {
  database.dispose()
}
