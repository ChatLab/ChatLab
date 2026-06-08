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

  it('streams planning draft as thinking and final plan text as plan deltas', async () => {
    const deltas: string[] = []
    const thinkingDeltas: string[] = []
    const validationDeltas: string[] = []
    let thinkingEnded = false
    let validationEnded = false
    const planner = createAnalysisPlanner({
      stream: async (_prompt, callbacks) => {
        callbacks.onThinkingDelta?.('先判断问题类型。')
        callbacks.onThinkingEnd?.(120)
        callbacks.onPlanDelta('年度话题趋势分析\n')
        callbacks.onPlanDelta('1. 按季度检索代表性话题\n')
        const json = JSON.stringify({
          title: '年度话题趋势分析',
          intent: 'trend',
          steps: [
            {
              goal: '按季度检索代表性话题',
              suggestedTools: ['search_messages'],
              evidenceNeeded: '每个季度的代表消息',
            },
          ],
          successCriteria: ['覆盖全年'],
        })
        callbacks.onValidationDelta?.(json)
        callbacks.onValidationEnd?.(80)
        return `<draft>
先判断问题类型。
</draft>
<plan>
年度话题趋势分析
1. 按季度检索代表性话题
</plan>
<json>
${json}
</json>`
      },
      onPlanDelta: (delta) => deltas.push(delta),
      onThinkingDelta: (delta) => thinkingDeltas.push(delta),
      onThinkingEnd: () => {
        thinkingEnded = true
      },
      onValidationDelta: (delta) => validationDeltas.push(delta),
      onValidationEnd: () => {
        validationEnded = true
      },
    })

    const plan = await planner(baseInput)

    assert.equal(plan?.title, '年度话题趋势分析')
    assert.deepEqual(deltas, ['年度话题趋势分析\n', '1. 按季度检索代表性话题\n'])
    assert.deepEqual(thinkingDeltas, ['先判断问题类型。'])
    assert.equal(validationDeltas.join('').includes('"suggestedTools":["search_messages"]'), true)
    assert.equal(thinkingEnded, true)
    assert.equal(validationEnded, true)
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

  it('includes available capability summaries in the planner prompt', async () => {
    let capturedPrompt = ''
    const planner = createAnalysisPlanner({
      complete: async (prompt) => {
        capturedPrompt = prompt
        return JSON.stringify({
          title: '趋势和图表分析',
          intent: 'trend',
          steps: [
            {
              goal: '确认 schema 后生成趋势图',
              suggestedTools: ['get_schema', 'render_chart'],
              evidenceNeeded: '按季度聚合后的趋势数据',
            },
          ],
          successCriteria: ['给出趋势证据'],
        })
      },
    })

    const plan = await planner({
      ...baseInput,
      availableTools: ['search_messages', 'get_schema', 'render_chart'],
      availableCapabilities: [
        {
          id: 'chart_generation',
          label: '图表生成',
          tools: ['get_schema', 'render_chart'],
          guidance: '趋势、排名、分布、占比用图更清楚时，可先调用 get_schema，再用 render_chart 生成一张图。',
        },
      ],
    })

    assert.equal(plan?.steps[0]?.suggestedTools.includes('render_chart'), true)
    assert.match(capturedPrompt, /availableCapabilities/)
    assert.match(capturedPrompt, /chart_generation/)
    assert.match(capturedPrompt, /get_schema/)
    assert.match(capturedPrompt, /render_chart/)
  })

  it('keeps display plan concise and leaves structured details to JSON', async () => {
    let capturedPrompt = ''
    const planner = createAnalysisPlanner({
      complete: async (prompt) => {
        capturedPrompt = prompt
        return JSON.stringify({
          title: '年度话题趋势分析',
          intent: 'trend',
          steps: [{ goal: '按季度检索', suggestedTools: ['search_messages'], evidenceNeeded: '季度证据' }],
          successCriteria: ['覆盖全年'],
        })
      },
    })

    await planner(baseInput)

    assert.match(capturedPrompt, /A concise user-facing analysis approach/)
    assert.match(capturedPrompt, /those details belong in <json>/)
  })
})
