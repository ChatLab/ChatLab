import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildPlanGuidance, createAnalysisPlanner, createPlanContentBlock } from '../planner'
import type { AnalysisPlanSummary } from '../planning-types'

const baseInput = {
  userMessage: '分析过去一年群里话题的变化趋势，按季度总结主要变化，并举出证据。',
  chatType: 'group' as const,
  locale: 'zh-CN',
  availableTools: ['search_messages', 'get_time_stats', 'get_member_stats'],
}

describe('createAnalysisPlanner', () => {
  it('parses valid JSON and filters suggested tools to the available set', async () => {
    const planner = createAnalysisPlanner({
      complete: async () =>
        JSON.stringify({
          title: '年度话题趋势分析',
          intent: 'trend',
          steps: [
            {
              goal: '按季度检索代表性话题',
              suggestedTools: ['search_messages', 'missing_tool'],
              evidenceNeeded: '每个季度的代表消息',
            },
          ],
          successCriteria: ['覆盖全年', '引用证据'],
        }),
    })

    const plan = await planner(baseInput)

    assert.equal(plan?.route, 'planned_execution')
    assert.equal(plan?.title, '年度话题趋势分析')
    assert.deepEqual(plan?.steps[0]?.suggestedTools, ['search_messages'])
  })

  it('limits steps and success criteria to five items', async () => {
    const planner = createAnalysisPlanner({
      complete: async () =>
        JSON.stringify({
          title: '复杂分析',
          intent: 'mixed',
          steps: Array.from({ length: 7 }, (_, index) => ({
            goal: `step ${index + 1}`,
            suggestedTools: ['search_messages'],
            evidenceNeeded: `evidence ${index + 1}`,
          })),
          successCriteria: ['a', 'b', 'c', 'd', 'e', 'f'],
        }),
    })

    const plan = await planner(baseInput)

    assert.equal(plan?.steps.length, 5)
    assert.equal(plan?.successCriteria.length, 5)
  })

  it('returns null for invalid planner JSON', async () => {
    const planner = createAnalysisPlanner({
      complete: async () => '{"title": "broken", "intent": "unknown", "steps": []}',
    })

    const plan = await planner(baseInput)

    assert.equal(plan, null)
  })

  it('creates versioned plan content blocks', () => {
    const plan: AnalysisPlanSummary = {
      version: 1,
      title: '年度话题趋势分析',
      route: 'planned_execution',
      intent: 'trend',
      steps: [{ goal: '按季度检索', suggestedTools: ['search_messages'], evidenceNeeded: '季度证据' }],
      successCriteria: ['覆盖全年'],
    }

    const block = createPlanContentBlock(plan)

    assert.equal(block.type, 'plan')
    assert.equal(block.version, 1)
    assert.equal(block.status, 'created')
    assert.deepEqual(block.plan, plan)
  })

  it('builds soft guidance from plan summaries', () => {
    const guidance = buildPlanGuidance({
      version: 1,
      title: '年度话题趋势分析',
      route: 'planned_execution',
      intent: 'trend',
      steps: [{ goal: '按季度检索', suggestedTools: ['search_messages'], evidenceNeeded: '季度证据' }],
      successCriteria: ['覆盖全年'],
    })

    assert.match(guidance, /suggested analysis plan/i)
    assert.match(guidance, /do not follow it mechanically/i)
    assert.match(guidance, /年度话题趋势分析/)
    assert.match(guidance, /search_messages/)
    assert.match(guidance, /覆盖全年/)
  })
})
