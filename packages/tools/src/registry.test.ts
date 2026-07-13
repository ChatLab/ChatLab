import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_TOOL_CATALOG } from '@openchatlab/core'
import {
  AGENT_TOOL_REGISTRY,
  MCP_TOOL_REGISTRY,
  SEMANTIC_SEARCH_TOOL_NAME,
  RETRIEVE_CHAT_EVIDENCE_TOOL_NAME,
  getToolByName,
} from './registry'

describe('agent tool registry metadata', () => {
  it('keeps agent registry categories aligned with the builtin catalog allowlist metadata', () => {
    const registeredCategories = new Map(AGENT_TOOL_REGISTRY.map((tool) => [tool.name, tool.category ?? 'core']))
    const mismatches = BUILTIN_TOOL_CATALOG.filter((tool) => registeredCategories.get(tool.name) !== tool.category).map(
      (tool) =>
        `${tool.name} (expected category=${tool.category}, got ${registeredCategories.get(tool.name) ?? 'missing'})`
    )

    assert.deepEqual(mismatches, [])
  })
})

describe('semantic_search_current_chat registry placement', () => {
  it('is registered in AGENT registry only, not MCP (privacy: no external semantic access in Phase 1)', () => {
    const inAgent = AGENT_TOOL_REGISTRY.some((t) => t.name === SEMANTIC_SEARCH_TOOL_NAME)
    const inMcp = MCP_TOOL_REGISTRY.some((t) => t.name === SEMANTIC_SEARCH_TOOL_NAME)
    assert.equal(inAgent, true)
    assert.equal(inMcp, false)
  })

  it('is resolvable by name and constrains inputs to query + max_results', () => {
    const tool = getToolByName(SEMANTIC_SEARCH_TOOL_NAME)
    assert.ok(tool)
    assert.deepEqual(Object.keys(tool!.inputSchema.properties).sort(), ['max_results', 'query'])
  })
})

describe('retrieve_chat_evidence registry placement', () => {
  it('is registered in AGENT registry only, not MCP', () => {
    const inAgent = AGENT_TOOL_REGISTRY.some((t) => t.name === RETRIEVE_CHAT_EVIDENCE_TOOL_NAME)
    const inMcp = MCP_TOOL_REGISTRY.some((t) => t.name === RETRIEVE_CHAT_EVIDENCE_TOOL_NAME)
    assert.equal(inAgent, true)
    assert.equal(inMcp, false)
  })

  it('is resolvable by name and requires query', () => {
    const tool = getToolByName(RETRIEVE_CHAT_EVIDENCE_TOOL_NAME)
    assert.ok(tool)
    assert.deepEqual(tool!.inputSchema.required, ['query'])
  })
})
