import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildProcessSegments,
  getProcessSegmentStatusLabel,
  getVisibleSegmentBlocks,
} from './chatMessageProcessSegments'

type TestBlock =
  | { type: 'text'; text: string }
  | { type: 'think'; text: string; durationMs?: number }
  | { type: 'tool'; name: string; durationMs?: number }
  | { type: 'chart'; title: string }
  | { type: 'evidence'; title: string }

const isFoldableProcessBlock = (block: TestBlock): boolean => block.type === 'think' || block.type === 'tool'

const isTextBlock = (block: TestBlock): boolean => block.type === 'text'

const getBlockDurationMs = (block: TestBlock): number => {
  if (block.type === 'think' || block.type === 'tool') return block.durationMs ?? 0
  return 0
}

describe('chat message process segments', () => {
  it('folds tool work and interstitial text before the final answer', () => {
    const blocks: TestBlock[] = [
      { type: 'think', text: '分析问题' },
      { type: 'tool', name: 'search_messages' },
      { type: 'text', text: '已经查到一些线索，继续确认。' },
      { type: 'tool', name: 'semantic_search_current_chat' },
      { type: 'text', text: '最终结论' },
    ]

    const segments = buildProcessSegments(blocks, { isFoldableProcessBlock, isTextBlock })

    assert.deepEqual(segments, [
      { type: 'process', blocks: blocks.slice(0, 4) },
      { type: 'visible', block: blocks[4] },
    ])
    assert.deepEqual(getVisibleSegmentBlocks(segments), [blocks[4]])
  })

  it('keeps result blocks visible and starts a new process segment after them', () => {
    const blocks: TestBlock[] = [
      { type: 'tool', name: 'get_time_stats' },
      { type: 'chart', title: '发言趋势' },
      { type: 'text', text: '图表之后继续核对。' },
      { type: 'tool', name: 'retrieve_chat_evidence' },
      { type: 'evidence', title: '证据' },
      { type: 'text', text: '最终解释' },
    ]

    const segments = buildProcessSegments(blocks, { isFoldableProcessBlock, isTextBlock })

    assert.deepEqual(segments, [
      { type: 'process', blocks: [blocks[0]] },
      { type: 'visible', block: blocks[1] },
      { type: 'process', blocks: blocks.slice(2, 4) },
      { type: 'visible', block: blocks[4] },
      { type: 'visible', block: blocks[5] },
    ])
    assert.deepEqual(getVisibleSegmentBlocks(segments), [blocks[1], blocks[4], blocks[5]])
  })

  it('keeps text visible when no later process block exists', () => {
    const blocks: TestBlock[] = [
      { type: 'tool', name: 'get_members' },
      { type: 'text', text: '最终答案' },
      { type: 'evidence', title: '引用' },
    ]

    const segments = buildProcessSegments(blocks, { isFoldableProcessBlock, isTextBlock })

    assert.deepEqual(segments, [
      { type: 'process', blocks: [blocks[0]] },
      { type: 'visible', block: blocks[1] },
      { type: 'visible', block: blocks[2] },
    ])
    assert.deepEqual(getVisibleSegmentBlocks(segments), [blocks[1], blocks[2]])
  })

  it('shows processing text for the active process segment', () => {
    const segment = {
      type: 'process' as const,
      blocks: [{ type: 'think' as const, text: '分析中', durationMs: 65_000 }],
    }

    const label = getProcessSegmentStatusLabel(segment, {
      getBlockDurationMs,
      isProcessing: true,
      labels: { processed: '已处理', processing: '处理中' },
      locale: 'zh-CN',
    })

    assert.equal(label, '处理中')
  })

  it('shows processed duration after the process segment completes', () => {
    const segment = {
      type: 'process' as const,
      blocks: [
        { type: 'think' as const, text: '分析中', durationMs: 60_000 },
        { type: 'tool' as const, name: 'search_messages', durationMs: 5_000 },
      ],
    }

    const label = getProcessSegmentStatusLabel(segment, {
      getBlockDurationMs,
      isProcessing: false,
      labels: { processed: '已处理', processing: '处理中' },
      locale: 'zh-CN',
    })

    assert.equal(label, '已处理 1分05秒')
  })
})
