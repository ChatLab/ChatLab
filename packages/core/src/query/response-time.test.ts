import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeResponseTimeStats, type ResponseTimeMessage } from './response-time'

function conversation(gaps: number[], responder = 2): ResponseTimeMessage[] {
  // sender 1 posts, responder replies after each gap; strictly increasing ts
  const rows: ResponseTimeMessage[] = []
  let ts = 100000
  for (const gap of gaps) {
    rows.push({ senderId: 1, name: 'Alice', ts })
    ts += gap
    rows.push({ senderId: responder, name: 'Bob', ts })
    ts += 3600
  }
  return rows
}

describe('computeResponseTimeStats', () => {
  it('computes median/avg/count for responders with enough samples', () => {
    const rows = conversation([10, 20, 30, 40])
    const stats = computeResponseTimeStats(rows, 10)

    assert.equal(stats.length, 1)
    const bob = stats[0]
    assert.equal(bob.id, 2)
    assert.equal(bob.name, 'Bob')
    assert.equal(bob.responseCount, 4)
    assert.equal(bob.avgSeconds, 25)
    assert.equal(bob.medianSeconds, 30)
  })

  it('ignores gaps outside the 5..1800s heuristic window', () => {
    const rows = conversation([3, 10, 20, 30, 2000])
    const stats = computeResponseTimeStats(rows, 10)
    assert.equal(stats[0].responseCount, 3)
  })

  it('drops responders with fewer than 3 responses', () => {
    const rows = conversation([10, 20])
    assert.deepEqual(computeResponseTimeStats(rows, 10), [])
  })

  it('ignores consecutive messages from the same sender', () => {
    const rows: ResponseTimeMessage[] = [
      { senderId: 1, name: 'Alice', ts: 1000 },
      { senderId: 1, name: 'Alice', ts: 1010 },
      { senderId: 1, name: 'Alice', ts: 1020 },
      { senderId: 1, name: 'Alice', ts: 1030 },
    ]
    assert.deepEqual(computeResponseTimeStats(rows, 10), [])
  })

  it('sorts by median ascending and honors topN', () => {
    const fast = conversation([10, 10, 10], 2)
    const slowStart = fast[fast.length - 1].ts + 10000
    const slow: ResponseTimeMessage[] = []
    let ts = slowStart
    for (let i = 0; i < 3; i++) {
      slow.push({ senderId: 1, name: 'Alice', ts })
      ts += 600
      slow.push({ senderId: 3, name: 'Carol', ts })
      ts += 3600
    }
    const stats = computeResponseTimeStats([...fast, ...slow], 10)
    assert.deepEqual(
      stats.map((s) => s.name),
      ['Bob', 'Carol']
    )

    const top1 = computeResponseTimeStats([...fast, ...slow], 1)
    assert.equal(top1.length, 1)
    assert.equal(top1[0].name, 'Bob')
  })
})
