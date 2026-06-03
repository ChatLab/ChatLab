import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CHAT_DB_SCHEMA, type ChartPayload } from '@openchatlab/core'
import { CoreDataProvider, renderChartTool } from '@openchatlab/tools'
import { openBetterSqliteDatabase } from '../../packages/node-runtime/src/better-sqlite3-adapter'

function resolveNativeBinding(): string | undefined {
  if (process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING) return process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING
  const repoNativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')
  return existsSync(repoNativeBinding) ? repoNativeBinding : undefined
}

function unixTs(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000)
}

function createTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'chatlab-chart-runtime-'))
}

function getChart(result: Awaited<ReturnType<typeof renderChartTool.handler>>): ChartPayload {
  assert.ok(result.chart, 'expected render_chart to return a chart payload')
  return result.chart
}

function seedChatDb(db: ReturnType<typeof openBetterSqliteDatabase>): void {
  db.exec(CHAT_DB_SCHEMA)
  db.prepare(
    `INSERT INTO meta (name, platform, type, imported_at, group_id, owner_id)
     VALUES ('Chart Test Group', 'wechat', 'group', ?, 'g1', 'u_alice')`
  ).run(unixTs('2026-06-03T00:00:00Z'))

  const insertMember = db.prepare(
    `INSERT INTO member (platform_id, account_name, group_nickname)
     VALUES (?, ?, ?)`
  )
  insertMember.run('u_alice', 'Alice Account', 'Alice')
  insertMember.run('u_bob', 'Bob Account', 'Bob')
  insertMember.run('u_cara', 'Cara Account', 'Cara')

  const memberRows = db.prepare('SELECT id, group_nickname FROM member').all() as Array<{
    id: number
    group_nickname: string
  }>
  const memberId = new Map(memberRows.map((row) => [row.group_nickname, row.id]))
  const insertMessage = db.prepare(
    `INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content, platform_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const add = (name: 'Alice' | 'Bob' | 'Cara', ts: string, type: number, content: string) => {
    const id = memberId.get(name)
    assert.ok(id, `missing member id for ${name}`)
    insertMessage.run(id, `${name} Account`, name, unixTs(ts), type, content, `${name}-${ts}`)
  }

  add('Alice', '2026-06-01T09:00:00Z', 0, 'morning hello')
  add('Alice', '2026-06-01T10:00:00Z', 0, 'standup note')
  add('Alice', '2026-06-02T09:00:00Z', 1, '[图片]')
  add('Alice', '2026-06-02T10:00:00Z', 0, 'follow up')
  add('Bob', '2026-06-01T09:00:00Z', 0, 'first reply')
  add('Bob', '2026-06-02T10:00:00Z', 0, 'second reply')
  add('Bob', '2026-06-02T11:00:00Z', 0, 'third reply')
  add('Cara', '2026-06-01T09:00:00Z', 0, 'other member')
  add('Cara', '2026-06-03T12:00:00Z', 0, 'outside selected members')
}

describe('render_chart integration with a real chat SQLite database', () => {
  it('executes read-only SQL against chat tables and returns flexible chart payloads', async () => {
    const dir = createTempDir()
    const dbPath = path.join(dir, 'chat.db')
    const nativeBinding = resolveNativeBinding()
    const db = openBetterSqliteDatabase(dbPath, { nativeBinding })

    try {
      seedChatDb(db)
      const dataProvider = new CoreDataProvider(db)
      const context = {
        sessionId: 'chart-test-session',
        locale: 'en-US',
        dataProvider,
      }
      const range = {
        startTs: unixTs('2026-06-01T00:00:00Z'),
        endTs: unixTs('2026-06-03T00:00:00Z'),
      }

      const pie = getChart(
        await renderChartTool.handler(
          {
            sql: `
              SELECT COALESCE(m.group_nickname, m.account_name, m.platform_id) AS name,
                     COUNT(*) AS message_count
              FROM message msg
              JOIN member m ON m.id = msg.sender_id
              WHERE COALESCE(m.group_nickname, m.account_name, m.platform_id) IN (@memberA, @memberB)
                AND msg.ts >= @startTs AND msg.ts < @endTs
              GROUP BY m.id
              ORDER BY message_count DESC, name ASC
            `,
            params: { memberA: 'Alice', memberB: 'Bob', ...range },
            chartSpec: {
              version: 1,
              type: 'pie',
              title: 'Selected members message share',
              encoding: { label: 'name', value: 'message_count' },
              filters: { members: [{ name: 'Alice' }, { name: 'Bob' }] },
            },
          },
          context
        )
      )
      assert.equal(pie.spec.type, 'pie')
      assert.deepEqual(pie.data, { labels: ['Alice', 'Bob'], values: [4, 3] })
      assert.deepEqual(
        pie.spec.filters?.members?.map((member) => member.name),
        ['Alice', 'Bob']
      )

      const line = getChart(
        await renderChartTool.handler(
          {
            sql: `
              SELECT date(msg.ts, 'unixepoch') AS day,
                     COALESCE(m.group_nickname, m.account_name, m.platform_id) AS member_name,
                     COUNT(*) AS message_count
              FROM message msg
              JOIN member m ON m.id = msg.sender_id
              WHERE COALESCE(m.group_nickname, m.account_name, m.platform_id) IN (@memberA, @memberB)
                AND msg.ts >= @startTs AND msg.ts < @endTs
              GROUP BY day, m.id
              ORDER BY day ASC, member_name ASC
            `,
            params: { memberA: 'Alice', memberB: 'Bob', ...range },
            chartSpec: {
              version: 1,
              type: 'line',
              title: 'Selected members daily trend',
              encoding: { x: 'day', y: 'message_count', series: 'member_name' },
            },
          },
          context
        )
      )
      assert.equal(line.spec.type, 'line')
      assert.deepEqual(line.data, {
        labels: ['2026-06-01', '2026-06-02'],
        values: [2, 2],
        series: [
          { name: 'Alice', values: [2, 2] },
          { name: 'Bob', values: [1, 2] },
        ],
      })

      const heatmap = getChart(
        await renderChartTool.handler(
          {
            sql: `
              SELECT strftime('%H', msg.ts, 'unixepoch') AS hour,
                     COALESCE(m.group_nickname, m.account_name, m.platform_id) AS member_name,
                     COUNT(*) AS message_count
              FROM message msg
              JOIN member m ON m.id = msg.sender_id
              WHERE msg.ts >= @startTs AND msg.ts < @endTs
              GROUP BY hour, m.id
              ORDER BY member_name ASC, hour ASC
            `,
            params: range,
            chartSpec: {
              version: 1,
              type: 'heatmap',
              title: 'Member hour density',
              encoding: { x: 'hour', y: 'member_name', value: 'message_count' },
            },
          },
          context
        )
      )
      assert.equal(heatmap.spec.type, 'heatmap')
      assert.deepEqual(heatmap.data, {
        xLabels: ['09', '10', '11'],
        yLabels: ['Alice', 'Bob', 'Cara'],
        data: [
          [0, 0, 2],
          [1, 0, 2],
          [0, 1, 1],
          [1, 1, 1],
          [2, 1, 1],
          [0, 2, 1],
        ],
      })
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  })

  it('does not mutate chat data when a WITH-prefixed write is attempted', async () => {
    const dir = createTempDir()
    const dbPath = path.join(dir, 'chat.db')
    const nativeBinding = resolveNativeBinding()
    const db = openBetterSqliteDatabase(dbPath, { nativeBinding })

    try {
      seedChatDb(db)
      const dataProvider = new CoreDataProvider(db)
      const context = {
        sessionId: 'chart-test-session',
        locale: 'en-US',
        dataProvider,
      }
      const beforeCount = (db.prepare('SELECT COUNT(*) AS count FROM message').get() as { count: number }).count

      await assert.rejects(
        async () =>
          renderChartTool.handler(
            {
              sql: `
                WITH victim AS (SELECT id FROM message LIMIT 1)
                DELETE FROM message WHERE id IN (SELECT id FROM victim)
              `,
              chartSpec: {
                version: 1,
                type: 'bar',
                title: 'Should not render',
                encoding: { x: 'name', y: 'message_count' },
              },
            },
            context
          ),
        /READ-ONLY|read-only|not authorized|readonly|SELECT|syntax/i
      )

      const afterCount = (db.prepare('SELECT COUNT(*) AS count FROM message').get() as { count: number }).count
      assert.equal(afterCount, beforeCount)
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  })
})
