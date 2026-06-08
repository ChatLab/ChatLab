import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AI_AGENT_ROUTING_EVALUATION_SET, REQUIRED_EVALUATION_SCENARIOS } from '../evaluation-set'

describe('AI agent routing evaluation set', () => {
  it('keeps a fixed phase-one sample size with stable unique ids', () => {
    assert.ok(AI_AGENT_ROUTING_EVALUATION_SET.length >= 20)
    assert.ok(AI_AGENT_ROUTING_EVALUATION_SET.length <= 30)

    const ids = new Set(AI_AGENT_ROUTING_EVALUATION_SET.map((item) => item.id))
    assert.equal(ids.size, AI_AGENT_ROUTING_EVALUATION_SET.length)
    for (const item of AI_AGENT_ROUTING_EVALUATION_SET) {
      assert.match(item.id, /^ai-route-eval-\d{3}$/)
    }
  })

  it('covers every expected route and required scenario', () => {
    const routes = new Set(AI_AGENT_ROUTING_EVALUATION_SET.map((item) => item.expectedRoute))
    assert.deepEqual(routes, new Set(['direct_response', 'tool_assisted', 'planned_execution']))

    const scenarios = new Set(AI_AGENT_ROUTING_EVALUATION_SET.flatMap((item) => item.scenarios))
    for (const scenario of REQUIRED_EVALUATION_SCENARIOS) {
      assert.ok(scenarios.has(scenario), `missing scenario: ${scenario}`)
    }
  })

  it('requires evidence coverage points for planned execution cases only', () => {
    for (const item of AI_AGENT_ROUTING_EVALUATION_SET) {
      if (item.expectedRoute === 'planned_execution') {
        assert.ok(item.expectedEvidenceCoverage.length >= 2, `${item.id} should define evidence coverage`)
      } else {
        assert.equal(item.expectedEvidenceCoverage.length, 0, `${item.id} should not define evidence coverage`)
      }
    }
  })

  it('marks baseline collection as pending real-environment execution', () => {
    for (const item of AI_AGENT_ROUTING_EVALUATION_SET) {
      assert.equal(item.baseline.status, 'pending_real_environment_run')
      assert.ok(item.baseline.notes.length > 0)
    }
  })
})
