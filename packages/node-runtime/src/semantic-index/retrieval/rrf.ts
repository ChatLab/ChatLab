/**
 * Reciprocal Rank Fusion（RRF）
 *
 * chunking-decision-final.md 第 10 节：dense 与 FTS 各自独立排序，在 Node 层用 RRF 融合，
 * 不依赖跨库 join。每个 id 的融合分 = Σ 1 / (k + rank)，rank 为该 id 在某个排序列表中的
 * 位次（0 为最优）；id 未出现在某列表时该列表不贡献分数。
 *
 * 纯函数，按 id 操作（此处 id 即 chunkId），与具体检索来源解耦。
 */

export interface RrfResult {
  id: string
  score: number
}

/**
 * @param rankedLists 多个已排序 id 列表，每个列表内 index 0 为最相关
 * @param k RRF 常数，默认 60（业界常用值，降低高位排名的极端权重）
 */
export function reciprocalRankFusion(rankedLists: string[][], k = 60): RrfResult[] {
  const scores = new Map<string, number>()
  const firstSeen = new Map<string, number>()
  let seq = 0

  for (const list of rankedLists) {
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank))
      if (!firstSeen.has(id)) firstSeen.set(id, seq++)
    })
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || firstSeen.get(a.id)! - firstSeen.get(b.id)!)
}
