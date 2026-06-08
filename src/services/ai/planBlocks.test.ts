import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  appendPlanDraftDelta,
  removePlanDraftBlocks,
  replacePlanDraftWithPlan,
  toPlanContentBlock,
  updateLastPlanBlockStatus,
  type PlanContentBlock,
} from './planBlocks'

const planBlock: PlanContentBlock = {
  type: 'plan',
  version: 1,
  status: 'created',
  plan: {
    version: 1,
    title: '年度话题趋势分析',
    route: 'planned_execution',
    intent: 'trend',
    steps: [{ goal: '按季度检索', suggestedTools: ['search_messages'], evidenceNeeded: '季度证据' }],
    successCriteria: ['覆盖全年'],
  },
}

describe('planBlocks', () => {
  it('creates a serializable copy of plan blocks', () => {
    const copy = toPlanContentBlock(planBlock)

    assert.deepEqual(copy, planBlock)
    assert.notEqual(copy, planBlock)
    assert.notEqual(copy.plan, planBlock.plan)
  })

  it('updates the last plan block status without mutating the original array', () => {
    const blocks = [planBlock]
    const updated = updateLastPlanBlockStatus(blocks, 'done')

    assert.equal(planBlock.status, 'created')
    assert.equal(updated[0]?.status, 'done')
    assert.notEqual(updated, blocks)
  })

  it('appends streamed plan draft text and replaces it with the final plan', () => {
    const draftBlocks = appendPlanDraftDelta([], '年度趋势分析\n')
    const updatedDraftBlocks = appendPlanDraftDelta(draftBlocks, '1. 按季度检索\n')

    assert.equal(updatedDraftBlocks.length, 1)
    assert.equal(updatedDraftBlocks[0]?.type, 'plan_draft')
    assert.equal(updatedDraftBlocks[0]?.text, '年度趋势分析\n1. 按季度检索\n')

    const finalBlocks = replacePlanDraftWithPlan(updatedDraftBlocks, planBlock)

    assert.equal(finalBlocks.length, 1)
    assert.equal(finalBlocks[0]?.type, 'plan')
    if (finalBlocks[0]?.type === 'plan') {
      assert.equal(finalBlocks[0].status, 'created')
      assert.equal(finalBlocks[0].displayText, '年度趋势分析\n1. 按季度检索')
    }
  })

  it('removes skipped plan draft blocks', () => {
    const draftBlocks = appendPlanDraftDelta([], '无法校验的计划草稿')
    const finalBlocks = removePlanDraftBlocks(draftBlocks)

    assert.deepEqual(finalBlocks, [])
  })

  it('replaces plan drafts in place without moving validation blocks', () => {
    const blocks = [
      { type: 'think' as const, tag: 'thinking', text: '准备计划' },
      { type: 'plan_draft' as const, version: 1 as const, status: 'streaming' as const, text: '正式计划' },
      { type: 'think' as const, tag: 'plan_validation', text: '{"steps":[]}' },
    ]

    const finalBlocks = replacePlanDraftWithPlan(blocks, planBlock)

    assert.deepEqual(
      finalBlocks.map((block) => block.type),
      ['think', 'plan', 'think']
    )
    assert.equal(finalBlocks[1]?.type, 'plan')
    if (finalBlocks[1]?.type === 'plan') {
      assert.equal(finalBlocks[1].displayText, '正式计划')
    }
    assert.equal(finalBlocks[2]?.type, 'think')
    if (finalBlocks[2]?.type === 'think') {
      assert.equal(finalBlocks[2].tag, 'plan_validation')
    }
  })
})
