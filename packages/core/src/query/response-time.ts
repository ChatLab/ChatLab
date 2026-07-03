/**
 * Response time analysis: heuristic reply-latency statistics.
 *
 * Pure aggregation over a time-ordered message stream. Shared by the
 * response_time_analysis AI tool and the CLI `stats response` command.
 */

export interface ResponseTimeMessage {
  senderId: number
  name: string
  ts: number
}

export interface ResponseTimeStat {
  id: number
  name: string
  avgSeconds: number
  medianSeconds: number
  responseCount: number
}

const MIN_GAP_SECONDS = 5
const MAX_GAP_SECONDS = 1800
const MIN_RESPONSES = 3

/**
 * Compute reply-latency stats per responder from messages sorted by ts ascending.
 * A "response" is a sender change with a gap in [5s, 30min]; responders need
 * at least 3 samples. Result is sorted by median ascending, sliced to topN.
 */
export function computeResponseTimeStats(rows: ResponseTimeMessage[], topN: number): ResponseTimeStat[] {
  const responseTimes = new Map<number, { name: string; times: number[] }>()

  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]
    const curr = rows[i]
    if (curr.senderId === prev.senderId) continue

    const gap = curr.ts - prev.ts
    if (gap < MIN_GAP_SECONDS || gap > MAX_GAP_SECONDS) continue

    if (!responseTimes.has(curr.senderId)) {
      responseTimes.set(curr.senderId, { name: curr.name, times: [] })
    }
    responseTimes.get(curr.senderId)!.times.push(gap)
  }

  return [...responseTimes.entries()]
    .map(([id, { name, times }]) => {
      times.sort((a, b) => a - b)
      const avg = Math.round(times.reduce((s, t) => s + t, 0) / times.length)
      const median = times[Math.floor(times.length / 2)]
      return { id, name, avgSeconds: avg, medianSeconds: median, responseCount: times.length }
    })
    .filter((s) => s.responseCount >= MIN_RESPONSES)
    .sort((a, b) => a.medianSeconds - b.medianSeconds)
    .slice(0, topN)
}
