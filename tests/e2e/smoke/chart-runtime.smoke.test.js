'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { createRequire } = require('node:module')

const { launchApp } = require('../helpers/app-launcher')

const shouldRunSmoke = process.env.CHATLAB_RUN_E2E_SMOKE === '1'

const CHAT_DB_SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    type TEXT NOT NULL,
    imported_at INTEGER NOT NULL,
    group_id TEXT,
    group_avatar TEXT,
    owner_id TEXT,
    schema_version INTEGER DEFAULT 5,
    session_gap_threshold INTEGER
  );

  CREATE TABLE IF NOT EXISTS member (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_id TEXT NOT NULL UNIQUE,
    account_name TEXT,
    group_nickname TEXT,
    aliases TEXT DEFAULT '[]',
    avatar TEXT,
    roles TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS member_name_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    name_type TEXT NOT NULL,
    name TEXT NOT NULL,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER,
    FOREIGN KEY(member_id) REFERENCES member(id)
  );

  CREATE TABLE IF NOT EXISTS message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    sender_account_name TEXT,
    sender_group_nickname TEXT,
    ts INTEGER NOT NULL,
    type INTEGER NOT NULL,
    content TEXT,
    reply_to_message_id TEXT DEFAULT NULL,
    platform_message_id TEXT DEFAULT NULL,
    FOREIGN KEY(sender_id) REFERENCES member(id)
  );

  CREATE TABLE IF NOT EXISTS segment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    message_count INTEGER DEFAULT 0,
    is_manual INTEGER DEFAULT 0,
    summary TEXT
  );

  CREATE TABLE IF NOT EXISTS message_context (
    message_id INTEGER PRIMARY KEY,
    segment_id INTEGER NOT NULL,
    topic_id INTEGER
  );
`

const AI_DB_SCHEMA = `
  CREATE TABLE IF NOT EXISTS ai_chat (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    title TEXT,
    active_message_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    assistant_id TEXT DEFAULT 'general_cn'
  );

  CREATE TABLE IF NOT EXISTS ai_message (
    id TEXT PRIMARY KEY,
    ai_chat_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    data_keywords TEXT,
    data_message_count INTEGER,
    content_blocks TEXT,
    token_usage TEXT,
    debug_context TEXT,
    parent_id TEXT,
    sibling_group_id TEXT,
    branch_index INTEGER DEFAULT 0,
    FOREIGN KEY(ai_chat_id) REFERENCES ai_chat(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_ai_chat_session ON ai_chat(session_id);
  CREATE INDEX IF NOT EXISTS idx_ai_message_ai_chat ON ai_message(ai_chat_id);
  CREATE INDEX IF NOT EXISTS idx_ai_message_parent ON ai_message(parent_id);
  CREATE INDEX IF NOT EXISTS idx_ai_message_sibling ON ai_message(sibling_group_id);
`

const SESSION_ID = 'chart-smoke-session'
const SESSION_NAME = 'Chart Smoke Group'
const AI_CHAT_ID = 'aichat_chart_smoke'
const AI_CHAT_TITLE = 'Chart replay smoke'
const CHART_TITLE = 'Selected members smoke'

let Database = null

function getDatabaseConstructor() {
  if (Database) return Database
  const nodeRuntimePackageJson = path.resolve(__dirname, '../../../packages/node-runtime/package.json')
  Database = createRequire(nodeRuntimePackageJson)('better-sqlite3')
  return Database
}

function resolveNativeBinding() {
  if (process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING) {
    return process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING
  }
  const repoNativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')
  return fs.existsSync(repoNativeBinding) ? repoNativeBinding : undefined
}

function unixTs(iso) {
  return Math.floor(Date.parse(iso) / 1000)
}

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-chart-ui-smoke-'))
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function seedChatSessionDb(chatDataDir) {
  const Database = getDatabaseConstructor()
  const dbDir = path.join(chatDataDir, 'databases')
  ensureDir(dbDir)
  const db = new Database(path.join(dbDir, `${SESSION_ID}.db`), {
    nativeBinding: resolveNativeBinding(),
  })

  try {
    db.exec(CHAT_DB_SCHEMA)
    db.prepare(
      `INSERT INTO meta (name, platform, type, imported_at, group_id, owner_id, schema_version)
       VALUES (?, ?, ?, ?, ?, ?, 5)`
    ).run(SESSION_NAME, 'wechat', 'group', unixTs('2026-06-03T00:00:00Z'), 'g_chart', 'u_alice')

    const insertMember = db.prepare(
      `INSERT INTO member (platform_id, account_name, group_nickname)
       VALUES (?, ?, ?)`
    )
    insertMember.run('u_alice', 'Alice Account', 'Alice')
    insertMember.run('u_bob', 'Bob Account', 'Bob')
    insertMember.run('u_cara', 'Cara Account', 'Cara')

    const members = db.prepare('SELECT id, group_nickname FROM member').all()
    const memberIds = new Map(members.map((row) => [row.group_nickname, row.id]))
    const insertMessage = db.prepare(
      `INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content, platform_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )

    const addMessage = (name, ts, type, content) => {
      const id = memberIds.get(name)
      assert.ok(id, `missing member id for ${name}`)
      insertMessage.run(id, `${name} Account`, name, unixTs(ts), type, content, `${name}-${ts}`)
    }

    addMessage('Alice', '2026-06-01T09:00:00Z', 0, 'morning hello')
    addMessage('Alice', '2026-06-01T10:00:00Z', 0, 'standup note')
    addMessage('Alice', '2026-06-02T09:00:00Z', 1, '[图片]')
    addMessage('Alice', '2026-06-02T10:00:00Z', 0, 'follow up')
    addMessage('Bob', '2026-06-01T09:00:00Z', 0, 'first reply')
    addMessage('Bob', '2026-06-02T10:00:00Z', 0, 'second reply')
    addMessage('Bob', '2026-06-02T11:00:00Z', 0, 'third reply')
    addMessage('Cara', '2026-06-01T09:00:00Z', 0, 'other member')
  } finally {
    db.close()
  }
}

function seedAiConversationDb(homeDir) {
  const Database = getDatabaseConstructor()
  const aiDir = path.join(homeDir, '.chatlab', 'ai')
  ensureDir(aiDir)
  const db = new Database(path.join(aiDir, 'conversations.db'), {
    nativeBinding: resolveNativeBinding(),
  })
  const now = Math.floor(Date.now() / 1000)
  const chartBlock = {
    type: 'chart',
    chart: {
      spec: {
        version: 1,
        type: 'pie',
        title: CHART_TITLE,
        encoding: { label: 'name', value: 'message_count' },
      },
      rowCount: 2,
      truncated: false,
      source: {
        sql: 'SELECT name, message_count FROM smoke_data',
        params: {},
      },
      data: {
        labels: ['Alice', 'Bob'],
        values: [4, 3],
      },
    },
  }

  try {
    db.exec(AI_DB_SCHEMA)
    db.prepare(
      `INSERT INTO ai_chat (id, session_id, title, active_message_id, created_at, updated_at, assistant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(AI_CHAT_ID, SESSION_ID, AI_CHAT_TITLE, 'msg_ai_chart', now - 120, now - 60, 'general_cn')

    db.prepare(
      `INSERT INTO ai_message (
         id, ai_chat_id, role, content, timestamp, data_keywords, data_message_count,
         content_blocks, token_usage, debug_context, parent_id, sibling_group_id, branch_index
       ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, 0)`
    ).run('msg_user_chart', AI_CHAT_ID, 'user', 'Show me Alice and Bob share.', now - 110, 'msg_user_chart')

    db.prepare(
      `INSERT INTO ai_message (
         id, ai_chat_id, role, content, timestamp, data_keywords, data_message_count,
         content_blocks, token_usage, debug_context, parent_id, sibling_group_id, branch_index
       ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, ?, ?, 0)`
    ).run(
      'msg_ai_chart',
      AI_CHAT_ID,
      'assistant',
      'Here is the chart.',
      now - 100,
      JSON.stringify([chartBlock]),
      'msg_user_chart',
      'msg_ai_chart'
    )
  } finally {
    db.close()
  }
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(error)
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(2000, () => {
      req.destroy(new Error('timeout'))
    })
  })
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now()
  let lastError = null

  while (Date.now() - start < timeoutMs) {
    try {
      const result = await fn()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  const suffix = lastError ? ` Last error: ${lastError.message}` : ''
  throw new Error(`${label} not ready within ${timeoutMs}ms.${suffix}`)
}

async function getRendererDebuggerUrl(port) {
  return waitFor(
    async () => {
      const targets = await httpGetJson(`http://127.0.0.1:${port}/json/list`)
      const pageTarget = targets.find(
        (target) =>
          target &&
          target.type === 'page' &&
          typeof target.webSocketDebuggerUrl === 'string' &&
          !String(target.url || '').startsWith('devtools://')
      )
      return pageTarget?.webSocketDebuggerUrl || null
    },
    15000,
    'Renderer target'
  )
}

async function createCdpClient(wsUrl) {
  return new Promise((resolve, reject) => {
    const pending = new Map()
    let nextId = 0
    const socket = new WebSocket(wsUrl)

    socket.addEventListener('open', () => {
      resolve({
        async send(method, params) {
          const id = ++nextId
          const payload = { id, method, params }
          const response = await new Promise((resolveSend, rejectSend) => {
            pending.set(id, { resolve: resolveSend, reject: rejectSend })
            socket.send(JSON.stringify(payload))
          })
          if (response.error) {
            throw new Error(response.error.message || `CDP ${method} failed`)
          }
          return response.result
        },
        close() {
          socket.close()
        },
      })
    })

    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data))
      if (!payload.id) return
      const handlers = pending.get(payload.id)
      if (!handlers) return
      pending.delete(payload.id)
      handlers.resolve(payload)
    })

    socket.addEventListener('error', (error) => {
      reject(error.error || error)
    })

    socket.addEventListener('close', () => {
      for (const [, handlers] of pending) {
        handlers.reject(new Error('CDP socket closed'))
      }
      pending.clear()
    })
  })
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(`Runtime.evaluate failed: ${JSON.stringify(result.exceptionDetails)}`)
  }
  return result.result?.value
}

async function getRendererSnapshot(client) {
  return evaluate(
    client,
    `
    (() => ({
      hash: location.hash,
      bodyId: document.body?.id || null,
      title: document.title,
      hasSessionName: document.body?.innerText.includes(${JSON.stringify(SESSION_NAME)}) || false,
      hasConversationTitle: document.body?.innerText.includes(${JSON.stringify(AI_CHAT_TITLE)}) || false,
      hasChartTitle: document.body?.innerText.includes(${JSON.stringify(CHART_TITLE)}) || false,
      canvasCount: document.querySelectorAll('canvas').length,
      textExcerpt: (document.body?.innerText || '').slice(0, 800),
    }))()
    `
  )
}

test(
  'E2E smoke: seeded chart conversation renders inside Electron AI chat',
  { skip: !shouldRunSmoke, timeout: 120000 },
  async () => {
    const tempRoot = createTempRoot()
    const homeDir = path.join(tempRoot, 'home')
    const userDataDir = path.join(tempRoot, 'electron-user-data')
    const chatDataDir = path.join(tempRoot, 'chat-data')

    ensureDir(homeDir)
    ensureDir(userDataDir)
    ensureDir(chatDataDir)
    seedChatSessionDb(chatDataDir)
    seedAiConversationDb(homeDir)

    let app = null
    let client = null

    try {
      app = await launchApp({
        startPort: 9232,
        startupWaitTime: 3000,
        userDataDir,
        envOverrides: {
          HOME: homeDir,
          USERPROFILE: homeDir,
          CHATLAB_DATA_DIR: chatDataDir,
        },
      })

      const wsUrl = await getRendererDebuggerUrl(app.port)
      client = await createCdpClient(wsUrl)
      await client.send('Runtime.enable')
      await client.send('Page.enable')

      await waitFor(
        async () =>
          evaluate(client, "document.readyState === 'complete' && !!document.body && !!document.querySelector('#app')"),
        15000,
        'Renderer document'
      )

      await evaluate(client, `location.hash = '#/group-chat/${SESSION_ID}?tab=ai-chat'`)

      await waitFor(
        async () =>
          evaluate(
            client,
            `document.body.id === 'page-group-chat' && document.body.innerText.includes(${JSON.stringify(SESSION_NAME)})`
          ),
        20000,
        'Group chat route'
      )

      await waitFor(
        async () => evaluate(client, `document.body.innerText.includes(${JSON.stringify(AI_CHAT_TITLE)})`),
        15000,
        'Conversation title'
      )

      await waitFor(
        async () =>
          evaluate(
            client,
            `
            (() => {
              const rows = [...document.querySelectorAll('div.group.relative.rounded-lg.cursor-pointer')]
              const target = rows.find((el) => el.innerText && el.innerText.includes(${JSON.stringify(AI_CHAT_TITLE)}))
              if (!target) return false
              target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
              return true
            })()
            `
          ),
        10000,
        'Conversation list item'
      )

      let chartState = null
      try {
        chartState = await waitFor(
          async () =>
            evaluate(
              client,
              `
              (() => {
                if (!document.body.innerText.includes(${JSON.stringify(CHART_TITLE)})) return null
                const canvas = document.querySelector('canvas')
                if (!canvas) return null
                const rect = canvas.getBoundingClientRect()
                if (rect.width < 200 || rect.height < 150) return null
                return {
                  bodyId: document.body.id,
                  chartTitlePresent: true,
                  canvasCount: document.querySelectorAll('canvas').length,
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                }
              })()
              `
            ),
          20000,
          'Chart render'
        )
      } catch (error) {
        const snapshot = await getRendererSnapshot(client)
        throw new Error(`${error.message} Snapshot: ${JSON.stringify(snapshot)}`)
      }

      assert.equal(chartState.bodyId, 'page-group-chat')
      assert.equal(chartState.chartTitlePresent, true)
      assert.ok(chartState.canvasCount >= 1, 'expected at least one chart canvas')
      assert.ok(chartState.width >= 200, `expected chart width >= 200, got ${chartState.width}`)
      assert.ok(chartState.height >= 150, `expected chart height >= 150, got ${chartState.height}`)
    } finally {
      if (client) {
        client.close()
      }
      if (app) {
        await app.close()
      }
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  }
)
