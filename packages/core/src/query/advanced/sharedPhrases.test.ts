import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MessageType } from '@openchatlab/shared-types'
import { CHAT_DB_SCHEMA } from '../../schema'
import { SqliteTestAdapter } from '../__tests__/sqlite-test-adapter'
import { getSharedPhrases, type SharedPhrasesParams, type SharedPhrasesResult } from './sharedPhrases'

const ALICE = 1
const BOB = 2
const baseTs = 1_786_200_000
const DAY = 86_400

/** One day per session keeps every line in its own time session unless `seconds` places it inside one. */
function at(session: number, seconds = 0): number {
  return baseTs + session * DAY + seconds
}

interface Line {
  sender: number
  ts: number
  content: string | null
  id?: number
  type?: MessageType
}

function createChat(lines: Line[], options: { type?: string; sessionGap?: number } = {}): SqliteTestAdapter {
  const db = new SqliteTestAdapter()
  db.exec(CHAT_DB_SCHEMA)
  db.prepare(
    "INSERT INTO meta (name, platform, type, imported_at, owner_id, session_gap_threshold) VALUES ('Chat', 'weixin', ?, 0, 'alice', ?)"
  ).run(options.type ?? 'private', options.sessionGap ?? null)
  db.prepare("INSERT INTO member (id, platform_id, account_name) VALUES (1, 'alice', 'Alice'), (2, 'bob', 'Bob')").run()
  const insert = db.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, ?, ?)')
  lines.forEach((line, index) =>
    insert.run(line.id ?? index + 1, line.sender, line.ts, line.type ?? MessageType.TEXT, line.content)
  )
  return db
}

function analyze(lines: Line[], params?: SharedPhrasesParams, options?: { type?: string; sessionGap?: number }) {
  const db = createChat(lines, options)
  try {
    return getSharedPhrases(db, params)
  } finally {
    db.close()
  }
}

function available(result: SharedPhrasesResult) {
  assert.equal(result.available, true)
  return result as Extract<SharedPhrasesResult, { available: true }>
}

/** phrase → [Alice's turns, Bob's turns, sessions], in ranking order. */
function summarize(result: SharedPhrasesResult): Array<[string, number, number, number]> {
  return available(result).phrases.map((item) => [
    item.phrase,
    item.members[0].turns,
    item.members[1].turns,
    item.sessions,
  ])
}

describe('getSharedPhrases', () => {
  it('reports why a chat has no shared phrases', () => {
    assert.deepEqual(
      analyze(
        [
          { sender: ALICE, ts: at(0), content: 'hi' },
          { sender: BOB, ts: at(1), content: 'hi' },
        ],
        undefined,
        { type: 'group' }
      ),
      { available: false, reason: 'not_private_chat' }
    )
    assert.deepEqual(analyze([{ sender: ALICE, ts: at(0), content: 'hi' }]), {
      available: false,
      reason: 'fewer_than_two_speakers',
    })
  })

  describe('display gate', () => {
    const cases: Array<{ name: string; lines: Line[]; sessionGap?: number; expected: ReturnType<typeof summarize> }> = [
      {
        name: 'shows a phrase both used in three turns across two sessions',
        lines: [
          { sender: ALICE, ts: at(0), content: 'dumpling night' },
          { sender: BOB, ts: at(0, 60), content: 'dumpling night' },
          { sender: ALICE, ts: at(1), content: 'dumpling night' },
        ],
        expected: [['dumpling night', 2, 1, 2]],
      },
      {
        name: 'hides a phrase only one participant used',
        lines: [
          { sender: ALICE, ts: at(0), content: 'dumpling night' },
          { sender: BOB, ts: at(0, 60), content: 'hello there' },
          { sender: ALICE, ts: at(1), content: 'dumpling night' },
          { sender: BOB, ts: at(1, 60), content: 'good morning' },
          { sender: ALICE, ts: at(2), content: 'dumpling night' },
        ],
        expected: [],
      },
      {
        name: 'hides a phrase used in only two turns',
        lines: [
          { sender: ALICE, ts: at(0), content: 'dumpling night' },
          { sender: BOB, ts: at(1), content: 'dumpling night' },
        ],
        expected: [],
      },
      {
        name: 'hides a phrase whose turns fall in one session',
        lines: [
          { sender: ALICE, ts: at(0), content: 'dumpling night' },
          { sender: BOB, ts: at(0, 60), content: 'dumpling night' },
          { sender: ALICE, ts: at(0, 120), content: 'dumpling night' },
        ],
        expected: [],
      },
      {
        name: "reads the session gap from the chat's session setting",
        lines: [
          { sender: ALICE, ts: at(0), content: 'dumpling night' },
          { sender: BOB, ts: at(0, 60), content: 'dumpling night' },
          { sender: ALICE, ts: at(0, 2_000), content: 'dumpling night' },
        ],
        sessionGap: 3_600,
        expected: [],
      },
      {
        name: 'counts repeats inside one turn once',
        lines: [
          { sender: ALICE, ts: at(0), content: 'dumpling night' },
          { sender: ALICE, ts: at(0, 60), content: 'dumpling night, dumpling night' },
          { sender: BOB, ts: at(1), content: 'dumpling night' },
        ],
        expected: [],
      },
    ]

    for (const { name, lines, sessionGap, expected } of cases) {
      it(name, () => {
        assert.deepEqual(summarize(analyze(lines, undefined, { sessionGap })), expected)
      })
    }
  })

  it('never produces phrases from links, mentions, emoji, media placeholders, single characters or numbers', () => {
    const turn = (sender: number, ts: number): Line[] =>
      ['https://example.com/menu', '@Alice', '[微笑]', '2024', 'a', '我', '[图片]', null].map((content, index) => ({
        sender,
        ts: ts + index,
        content,
        type: content === null ? MessageType.IMAGE : MessageType.TEXT,
      }))
    const result = available(analyze([...turn(ALICE, at(0)), ...turn(BOB, at(1)), ...turn(ALICE, at(2))]))

    assert.deepEqual(result.phrases, [])
    assert.deepEqual(result.coverage, {
      startTs: at(0),
      endTs: at(2, 7),
      textMessages: 18,
      excludedMessages: 6,
      turns: 3,
      sessions: 3,
    })
  })

  it('merges the same text from the word and Han channels without counting a turn twice', () => {
    const result = available(
      analyze([
        { sender: ALICE, ts: at(0), content: '火锅' },
        { sender: BOB, ts: at(1), content: '火锅' },
        { sender: ALICE, ts: at(2), content: '火锅' },
      ])
    )

    assert.deepEqual(
      result.phrases.map((item) => [item.phrase, item.channels, item.members[0].turns, item.members[1].turns]),
      [['火锅', ['token', 'han'], 2, 1]]
    )
  })

  it('joins words only as they were written: Chinese words touching, Latin words with one space', () => {
    const cases: Array<[string[], ReturnType<typeof summarize>]> = [
      // Punctuation and links end a phrase between Chinese words, so "好的明天见" never appears.
      [
        ['好的，明天见', '好的！明天见', '好的 https://example.com 明天见'],
        [
          ['明天见', 2, 1, 3],
          ['好的', 2, 1, 3],
        ],
      ],
      [['周末iPhone见', '周末 iPhone 见', '周末IPHONE见'], [['周末 iphone 见', 2, 1, 3]]],
    ]

    for (const [contents, expected] of cases) {
      const lines = contents.map((content, session) => ({
        sender: session % 2 === 0 ? ALICE : BOB,
        ts: at(session),
        content,
      }))
      assert.deepEqual(summarize(analyze(lines)), expected, contents[0])
    }
  })

  it('keeps the longest of nested phrases with the same occurrences and keeps phrases whose occurrences differ', () => {
    const lines: Line[] = [
      { sender: ALICE, ts: at(0), content: 'hot dumpling night' },
      { sender: BOB, ts: at(1), content: 'hot dumpling night' },
      { sender: ALICE, ts: at(2), content: 'hot dumpling night' },
      { sender: BOB, ts: at(3), content: 'dumpling night' },
      { sender: ALICE, ts: at(4), content: 'dumpling night' },
      // "nice day" contains the text "ice" and has the same counts, but not the same turns.
      { sender: ALICE, ts: at(5), content: 'ice' },
      { sender: BOB, ts: at(6), content: 'ice' },
      { sender: ALICE, ts: at(7), content: 'ice' },
      { sender: ALICE, ts: at(8), content: 'nice day' },
      { sender: BOB, ts: at(9), content: 'nice day' },
      { sender: ALICE, ts: at(10), content: 'nice day' },
    ]

    assert.deepEqual(
      summarize(analyze(lines)).sort((x, y) => (x[0] < y[0] ? -1 : 1)),
      [
        ['dumpling night', 3, 2, 5],
        ['hot dumpling night', 2, 1, 3],
        ['ice', 2, 1, 3],
        ['nice day', 2, 1, 3],
      ]
    )
  })

  it('ranks phrases made only of stopwords after the others', () => {
    const repeat = (content: string, sessions: number[]): Line[] =>
      sessions.map((session, index) => ({ sender: index % 2 === 0 ? ALICE : BOB, ts: at(session), content }))
    const lines = [
      ...repeat('see you', [0, 1, 2, 3]),
      ...repeat('其实', [4, 5, 6]),
      ...repeat('dumpling night', [7, 8, 9]),
    ]

    assert.deepEqual(
      summarize(analyze(lines)).map(([phrase]) => phrase),
      ['dumpling night', 'see you', '其实']
    )
  })

  it("finds each participant's first use by timestamp and lists at most three examples in time order", () => {
    // Ids run against time, as when an older export is imported after a newer one.
    const lines: Line[] = [
      { id: 90, sender: ALICE, ts: at(0), content: 'dumpling night' },
      { id: 80, sender: BOB, ts: at(1), content: 'dumpling night' },
      { id: 70, sender: ALICE, ts: at(2), content: 'dumpling night' },
      { id: 60, sender: BOB, ts: at(3), content: 'dumpling night' },
      { id: 50, sender: ALICE, ts: at(4), content: 'dumpling night' },
      { id: 40, sender: ALICE, ts: at(5), content: 'dumpling night' },
    ]
    const result = available(analyze(lines))

    assert.deepEqual(result.phrases[0]?.members, [
      { memberId: ALICE, turns: 4, firstMessageId: 90, firstTs: at(0), exampleMessageIds: [90, 70, 50] },
      { memberId: BOB, turns: 2, firstMessageId: 80, firstTs: at(1), exampleMessageIds: [80, 60] },
    ])
    assert.deepEqual(
      result.exampleMessages.map((message) => [message.id, message.ts, message.content]),
      [90, 80, 70, 60, 50].map((id, index) => [id, at(index), 'dumpling night'])
    )
  })

  it('returns at most `limit` phrases and says whether more passed the gate', () => {
    const turn = (sender: number, session: number): Line[] =>
      ['alpha', 'bravo', 'charlie'].map((content, index) => ({ sender, ts: at(session, index), content }))
    const lines = [...turn(ALICE, 0), ...turn(BOB, 1), ...turn(ALICE, 2)]

    const limited = available(analyze(lines, { limit: 2 }))
    assert.deepEqual(
      limited.phrases.map((item) => item.phrase),
      // Equal counts: the longer phrase first, then the earlier first use.
      ['charlie', 'alpha']
    )
    assert.equal(limited.hasMore, true)
    assert.equal(available(analyze(lines, { limit: 3 })).hasMore, false)
  })

  it('includes messages at both ends of the time range', () => {
    const lines: Line[] = [
      { sender: ALICE, ts: at(0), content: 'dumpling night' },
      { sender: BOB, ts: at(1), content: 'dumpling night' },
      { sender: ALICE, ts: at(2), content: 'dumpling night' },
    ]
    const cases: Array<[SharedPhrasesParams['timeFilter'], number]> = [
      [{ startTs: at(0), endTs: at(2) }, 1],
      [{ startTs: at(0) + 1, endTs: at(2) }, 0],
      [{ startTs: at(0), endTs: at(2) - 1 }, 0],
    ]

    for (const [timeFilter, phraseCount] of cases) {
      assert.equal(available(analyze(lines, { timeFilter })).phrases.length, phraseCount, JSON.stringify(timeFilter))
    }
  })
})
