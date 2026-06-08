import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { toPlanContentBlock, updateLastPlanBlockStatus, type PlanContentBlock } from './planBlocks'

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
})
