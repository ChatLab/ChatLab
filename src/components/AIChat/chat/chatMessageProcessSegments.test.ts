import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildProcessSegments,
  findRepresentativeProcessThought,
  getProcessSegmentStatusLabel,
  getVisibleSegmentBlocks,
  isActiveProcessSegment,
  resolveProcessHeaderActivity,
  resolveProcessElapsedMs,
} from './chatMessageProcessSegments'

type TestBlock =
  | { type: 'text'; text: string }
  | { type: 'think'; text: string; durationMs?: number }
  | { type: 'tool'; name: string; durationMs?: number }
  | { type: 'skill'; name: string }
  | { type: 'error'; message: string }
  | { type: 'chart'; title: string }
  | { type: 'evidence'; title: string }

const isFoldableProcessBlock = (block: TestBlock): boolean =>
  block.type === 'think' || block.type === 'tool' || block.type === 'skill' || block.type === 'error'

const isTextBlock = (block: TestBlock): boolean => block.type === 'text'

const getBlockDurationMs = (block: TestBlock): number => {
  if (block.type === 'think' || block.type === 'tool') return block.durationMs ?? 0
  return 0
}

describe('chat message process segments', () => {
  it('folds tool work and interstitial text after the answer completes', () => {
    const blocks: TestBlock[] = [
      { type: 'think', text: '分析问题' },
      { type: 'tool', name: 'search_messages' },
      { type: 'text', text: '已经查到一些线索，继续确认。' },
      { type: 'tool', name: 'semantic_search_current_chat' },
      { type: 'text', text: '最终结论' },
    ]

    const segments = buildProcessSegments(blocks, {
      isFoldableProcessBlock,
      isTextBlock,
      mode: 'completed',
    })

    assert.deepEqual(segments, [
      { type: 'process', blocks: blocks.slice(0, 4) },
      { type: 'visible', block: blocks[4] },
    ])
    assert.deepEqual(getVisibleSegmentBlocks(segments), [blocks[4]])
  })

  it('keeps one process segment while result blocks remain visible', () => {
    const blocks: TestBlock[] = [
      { type: 'tool', name: 'get_time_stats' },
      { type: 'chart', title: '发言趋势' },
      { type: 'text', text: '图表之后继续核对。' },
      { type: 'skill', name: 'relationship-analysis' },
      { type: 'tool', name: 'retrieve_chat_evidence' },
      { type: 'error', message: '部分证据读取失败' },
      { type: 'evidence', title: '证据' },
      { type: 'text', text: '最终解释' },
    ]

    const segments = buildProcessSegments(blocks, {
      isFoldableProcessBlock,
      isTextBlock,
      mode: 'completed',
    })

    assert.deepEqual(segments, [
      { type: 'process', blocks: [blocks[0], blocks[2], blocks[3], blocks[4], blocks[5]] },
      { type: 'visible', block: blocks[1] },
      { type: 'visible', block: blocks[6] },
      { type: 'visible', block: blocks[7] },
    ])
    assert.deepEqual(getVisibleSegmentBlocks(segments), [blocks[1], blocks[6], blocks[7]])
  })

  it('keeps live blocks in chronological process groups', () => {
    const blocks: TestBlock[] = [
      { type: 'think', text: '先看这周在聊什么' },
      { type: 'tool', name: 'search_messages' },
      { type: 'text', text: '证据拿到了，我再核对统计。' },
      { type: 'tool', name: 'get_time_stats' },
      { type: 'think', text: '核对统计结果' },
      { type: 'text', text: '最终结论' },
    ]

    const segments = buildProcessSegments(blocks, {
      isFoldableProcessBlock,
      isTextBlock,
      mode: 'timeline',
    })

    assert.deepEqual(segments, [
      { type: 'process', blocks: blocks.slice(0, 2) },
      { type: 'visible', block: blocks[2] },
      { type: 'process', blocks: blocks.slice(3, 5) },
      { type: 'visible', block: blocks[5] },
    ])
    assert.deepEqual(getVisibleSegmentBlocks(segments), [blocks[2], blocks[5]])
  })

  it('does not move visible text when later process work arrives', () => {
    const blocks: TestBlock[] = [
      { type: 'think', text: '分析问题' },
      { type: 'text', text: '先说明一部分结果。' },
    ]
    const beforeTool = buildProcessSegments(blocks, {
      isFoldableProcessBlock,
      isTextBlock,
      mode: 'timeline',
    })

    blocks.push({ type: 'tool', name: 'search_messages' })
    const afterTool = buildProcessSegments(blocks, {
      isFoldableProcessBlock,
      isTextBlock,
      mode: 'timeline',
    })

    assert.deepEqual(beforeTool, [
      { type: 'process', blocks: [blocks[0]] },
      { type: 'visible', block: blocks[1] },
    ])
    assert.deepEqual(afterTool, [
      { type: 'process', blocks: [blocks[0]] },
      { type: 'visible', block: blocks[1] },
      { type: 'process', blocks: [blocks[2]] },
    ])
    assert.equal(isActiveProcessSegment(afterTool, 0, true), false)
    assert.equal(isActiveProcessSegment(afterTool, 2, true), true)
  })

  it('allows the completed duration to exclude final response generation', () => {
    assert.equal(
      resolveProcessElapsedMs({
        isStreaming: true,
        liveElapsedMs: 20_000,
        settledElapsedMs: 15_000,
        recordedElapsedMs: 5_500,
      }),
      20_000
    )
    assert.equal(
      resolveProcessElapsedMs({
        isStreaming: false,
        liveElapsedMs: 20_000,
        settledElapsedMs: 15_000,
        recordedElapsedMs: 5_500,
      }),
      15_000
    )
  })

  it('uses natural-language thinking for the collapsed preview instead of plan JSON', () => {
    const reasoning = { type: 'think' as const, tag: 'reasoning', text: '先梳理长期变化' }
    const planValidation = { type: 'think' as const, tag: 'plan_validation', text: '{\n  "title": "分析计划"' }

    assert.equal(findRepresentativeProcessThought([reasoning, planValidation]), reasoning)
    assert.equal(findRepresentativeProcessThought([planValidation]), undefined)
  })

  it('keeps text visible when no later process block exists', () => {
    const blocks: TestBlock[] = [
      { type: 'tool', name: 'get_members' },
      { type: 'text', text: '最终答案' },
      { type: 'evidence', title: '引用' },
    ]

    const segments = buildProcessSegments(blocks, {
      isFoldableProcessBlock,
      isTextBlock,
      mode: 'completed',
    })

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

  it('prefers the live tool over the last foldable block while processing', () => {
    assert.deepEqual(
      resolveProcessHeaderActivity({
        isActive: true,
        activeToolName: 'retrieve_chat_evidence',
        activeToolProgressPhase: 'semantic_search',
        lastFoldable: { kind: 'think' },
      }),
      { type: 'tool', name: 'retrieve_chat_evidence', progressPhase: 'semantic_search' }
    )
    assert.deepEqual(
      resolveProcessHeaderActivity({
        isActive: false,
        lastFoldable: { kind: 'tool', name: 'search_messages' },
      }),
      { type: 'generic' }
    )
  })
})
