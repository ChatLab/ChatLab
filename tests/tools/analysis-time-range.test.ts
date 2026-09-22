import assert from 'node:assert/strict'
import { describe, it, type TestContext } from 'node:test'
import { openTestSqliteDatabase } from '../helpers/sqlite.mts'
import { SqliteTestAdapter } from '../../packages/core/src/query/__tests__/sqlite-test-adapter'
import { CoreDataProvider } from '../../packages/tools/src/providers/core-data-provider'
import { keywordFrequencyTool } from '../../packages/tools/src/definitions/keyword-frequency'
import { responseTimeAnalysisTool } from '../../packages/tools/src/definitions/response-time-analysis'
import { executeToolForAgent, toAgentToolParameters } from '../../packages/tools/src/agent-adapter'
import type { ToolExecutionContext, ToolResult } from '../../packages/tools/src/types'

const historical = { startTs: 1704067200, endTs: 1704067620 }
const explicit = { start_time: '2024-01-01T00:00:00Z', end_time: '2024-01-01T00:07:00Z' }

function createFixture(t: TestContext) {
  const db = openTestSqliteDatabase()
  t.after(() => db.close())
  db.exec(`
    CREATE TABLE member (id INTEGER PRIMARY KEY, account_name TEXT, group_nickname TEXT);
    CREATE TABLE message (sender_id INTEGER, content TEXT, type INTEGER, ts INTEGER);
    INSERT INTO member VALUES (1, 'Alice', NULL), (2, 'Bob', NULL);
  `)
  const recentStart = (db.prepare("SELECT unixepoch('now', '-14 days') AS ts").get() as { ts: number }).ts
  const recent = { startTs: recentStart, endTs: recentStart + 70 }
  const insert = db.prepare('INSERT INTO message VALUES (?, ?, 0, ?)')
  for (let i = 0; i < 8; i++) {
    insert.run((i % 2) + 1, 'historical', historical.startTs + i * 60)
    insert.run((i % 2) + 1, 'recent', recent.startTs + i * 10)
  }
  const context: ToolExecutionContext = {
    sessionId: 'test-session',
    locale: 'en-US',
    dataProvider: new CoreDataProvider(new SqliteTestAdapter(db)),
    segmentText(texts, _locale, options) {
      const words = new Map<string, number>()
      for (const text of texts) words.set(text, (words.get(text) ?? 0) + 1)
      return {
        words: new Map(
          [...words].filter(([, count]) => count >= Number(options.minCount)).slice(0, Number(options.topN))
        ),
        uniqueWords: words.size,
        totalWords: texts.length,
      }
    },
  }
  return { db, insert, context, recent }
}

function assertAnalysis(result: ToolResult, keyword: string, interval: string, period: string, topN = 2) {
  assert.ok(result.data, result.content)
  assert.deepEqual(JSON.parse(result.content), result.data)
  const data = result.data as Record<string, unknown>
  if ('keywords' in data) {
    assert.equal(data.totalMessages, 8)
    assert.equal(data.totalKeywords, 1)
    assert.deepEqual(data.keywords, [`1. ${keyword} (8)`])
  } else {
    assert.equal(data.totalResponders, topN)
    assert.deepEqual(
      data.ranking,
      [
        `1. Bob — median ${interval}, avg ${interval} (4 responses)`,
        `2. Alice — median ${interval}, avg ${interval} (3 responses)`,
      ].slice(0, topN)
    )
  }
  assert.equal(data.period, period)
}

function rangePeriod(range: typeof historical, locale = 'en-US') {
  return `${new Date(range.startTs * 1000).toLocaleString(locale)} – ${new Date(range.endTs * 1000).toLocaleString(locale)}`
}

for (const tool of [keywordFrequencyTool, responseTimeAnalysisTool]) {
  describe(tool.name, () => {
    for (const params of [{}, { days: 7 }, { start_time: 'invalid', end_time: 'invalid' }]) {
      it(`inherits the selected historical range with ${JSON.stringify(params)}`, async (t) => {
        const { db, context } = createFixture(t)
        context.timeFilter = historical
        assertAnalysis(await tool.handler(params, context), 'historical', '1m0s', rangePeriod(historical))
        db.prepare('DELETE FROM message WHERE ts > ?').run(historical.endTs)
        assertAnalysis(await tool.handler(params, context), 'historical', '1m0s', rangePeriod(historical))
      })
    }

    it('explicit dates override the selected range and days, including both endpoints', async (t) => {
      const { insert, context, recent } = createFixture(t)
      context.timeFilter = recent
      insert.run(2, 'outside', historical.startTs - 60)
      insert.run(2, 'outside', historical.startTs - 1)
      insert.run(1, 'outside', historical.endTs + 1)
      insert.run(2, 'outside', historical.endTs + 60)
      const result = await tool.handler({ ...explicit, days: 7, top_n: 1 }, context)
      assertAnalysis(result, 'historical', '1m0s', rangePeriod(historical), 1)
    })

    it('retains default days, custom days and invalid-date fallback without a selected range', async (t) => {
      const { context } = createFixture(t)
      for (const params of [{}, { days: 30 }, { start_time: 'invalid' }, { start_time: '', end_time: '' }]) {
        assertAnalysis(await tool.handler(params, context), 'recent', '10s', 'Last 30 days')
      }
      assert.equal((await tool.handler({ days: 7 }, context)).data, null)
      assertAnalysis(await tool.handler({ days: 20 }, context), 'recent', '10s', 'Last 20 days')
    })

    it('uses the shared parser defaults for one-sided dates', async (t) => {
      const { context, recent } = createFixture(t)
      context.timeFilter = recent
      const result = await tool.handler({ end_time: explicit.end_time }, context)
      assertAnalysis(result, 'historical', '1m0s', rangePeriod({ startTs: 0, endTs: historical.endTs }))
      context.timeFilter = historical
      const before = Math.floor(Date.now() / 1000)
      const startOnly = await tool.handler({ start_time: new Date(recent.startTs * 1000).toISOString() }, context)
      const after = Math.floor(Date.now() / 1000)
      const period = (startOnly.data as { period: string }).period
      assert.ok(
        Array.from({ length: after - before + 1 }, (_, i) => rangePeriod({ ...recent, endTs: before + i })).includes(
          period
        )
      )
      assertAnalysis(startOnly, 'recent', '10s', period)
    })

    it('returns no data for empty or reversed ranges', async (t) => {
      const { context } = createFixture(t)
      for (const timeFilter of [
        { startTs: historical.startTs - 10, endTs: historical.startTs - 1 },
        { startTs: historical.endTs, endTs: historical.startTs },
      ]) {
        assert.equal((await tool.handler({}, { ...context, timeFilter })).data, null)
      }
    })

    it('keeps Chinese period labels and content/data consistent', async (t) => {
      const { context } = createFixture(t)
      context.locale = 'zh-CN'
      for (const timeFilter of [historical, undefined]) {
        const result = await tool.handler({}, { ...context, timeFilter })
        assert.deepEqual(JSON.parse(result.content), result.data)
        assert.equal(
          (result.data as { period: string }).period,
          timeFilter ? rangePeriod(historical, 'zh-CN') : '近30天'
        )
      }
    })

    it('exposes optional dates and returns historical results through the shared Agent adapter', async (t) => {
      const { context } = createFixture(t)
      const schema = toAgentToolParameters(tool.inputSchema)
      assert.deepEqual(schema.required, [])
      for (const key of ['start_time', 'end_time']) {
        assert.equal((schema.properties[key] as { type: string }).type, 'string')
      }
      const result = await executeToolForAgent(tool, { days: 7 }, { ...context, timeFilter: historical })
      assertAnalysis(
        { content: result.content[0].text, data: result.details },
        'historical',
        '1m0s',
        rangePeriod(historical)
      )
      assert.notEqual(result.isError, true)
    })

    it('preserves database failures and the existing adapter error result', async (t) => {
      const { db, context } = createFixture(t)
      db.exec('DROP TABLE message')
      await assert.rejects(async () => tool.handler({}, context), /no such table: message/)
      const result = await executeToolForAgent(tool, {}, context)
      assert.equal(result.isError, true)
      assert.equal(result.details, null)
      assert.match(result.content[0].text, /no such table: message/)
    })
  })
}

it('keyword_frequency preserves its missing-segmentation result', async (t) => {
  const { context } = createFixture(t)
  assert.equal((await keywordFrequencyTool.handler({}, { ...context, segmentText: undefined })).data, null)
})

it('response_time_analysis does not borrow preceding messages from outside the selected range', async (t) => {
  const { context } = createFixture(t)
  const result = await responseTimeAnalysisTool.handler(
    {},
    {
      ...context,
      timeFilter: { startTs: historical.startTs + 180, endTs: historical.endTs },
    }
  )
  assert.equal(result.data, null)
})
