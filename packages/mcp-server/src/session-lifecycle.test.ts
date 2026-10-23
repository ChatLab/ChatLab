import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CHAT_DB_TABLES } from '@openchatlab/core'
import type { DatabaseAdapter } from '@openchatlab/core'
import { DatabaseManager, NodePathProvider } from '@openchatlab/node-runtime'
import { startMcpServer } from './server'
import { openTestSqliteDatabase } from '../../../tests/helpers/sqlite.mts'

test('MCP list_sessions closes each read transaction before opening the next one', async (t) => {
  const root = fs.mkdtempSync(path.join(process.cwd(), '.chatlab-mcp-list-lifecycle-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dataDir = path.join(root, 'data')
  const dbDir = path.join(dataDir, 'databases')
  fs.mkdirSync(dbDir, { recursive: true })

  const firstPath = path.join(dbDir, 'first.db')
  const fixture = openTestSqliteDatabase(firstPath)
  try {
    fixture.pragma('journal_mode = WAL')
    fixture.exec(CHAT_DB_TABLES)
    fixture.exec(`
      INSERT INTO meta (name, platform, type, imported_at)
      VALUES ('Session One', 'qq', 'group', 1000);
    `)
  } finally {
    fixture.close()
  }
  const secondPath = path.join(dbDir, 'second.db')
  fs.copyFileSync(firstPath, secondPath)
  const second = openTestSqliteDatabase(secondPath)
  try {
    second.exec("UPDATE meta SET name = 'Session Two'")
  } finally {
    second.close()
  }

  const pathProvider = new NodePathProvider(dataDir)
  const manager = new DatabaseManager(pathProvider, { runtime: { version: '0.37.6', kind: 'mcp' } })
  t.after(() => manager.closeAll())
  manager.raiseCurrentChatDbCompatibilityGate()
  const markerPath = path.join(dataDir, '.chatlab-meta.json')
  const beforeMarker = fs.readFileSync(markerPath)

  let activeConnections = 0
  let peakConnections = 0
  let sessionsOpened = 0
  let sessionsClosed = 0
  const trackedManager = {
    listSessionIdsMcpReadonly: () => manager.listSessionIdsMcpReadonly(),
    openMcpReadonly(sessionId: string): DatabaseAdapter | null {
      const db = manager.openMcpReadonly(sessionId)
      if (!db) return null
      activeConnections++
      sessionsOpened++
      peakConnections = Math.max(peakConnections, activeConnections)
      return {
        readonly: db.readonly,
        exec: (sql) => db.exec(sql),
        prepare: (sql) => db.prepare(sql),
        transaction: (fn) => db.transaction(fn),
        pragma: (pragma) => db.pragma(pragma),
        close() {
          db.close()
          activeConnections--
          sessionsClosed++
        },
      }
    },
  }

  const client = new Client({ name: 'session-list-lifetime-test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const connect = McpServer.prototype.connect
  t.mock.method(McpServer.prototype, 'connect', function (this: McpServer) {
    t.after(() => this.close())
    return connect.call(this, serverTransport)
  })

  await startMcpServer({ version: '0.37.6', dbManager: trackedManager })
  await client.connect(clientTransport)
  try {
    const result = await client.callTool({ name: 'chatlab_list_sessions', arguments: { format: 'json' } })
    assert.equal(result.isError, undefined, JSON.stringify(result.content))
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text)
    assert.equal(parsed.total, 2)
    assert.deepEqual(parsed.sessions.map((s: { id: string }) => s.id).sort(), ['first', 'second'])
    assert.equal(peakConnections, 1, 'a second session connection opened before the previous one was closed')
    assert.equal(activeConnections, 0)
    assert.equal(sessionsOpened, 2)
    assert.equal(sessionsClosed, 2)

    const resource = await client.readResource({ uri: 'chatlab://sessions' })
    assert.match(JSON.stringify(resource.contents), /Session One/)
    assert.match(JSON.stringify(resource.contents), /Session Two/)
    assert.ok(fs.readdirSync(dbDir).includes('first.db'))
    assert.ok(fs.readdirSync(dbDir).includes('second.db'))
    assert.deepEqual(fs.readFileSync(markerPath), beforeMarker)
  } finally {
    await client.close()
  }
})
