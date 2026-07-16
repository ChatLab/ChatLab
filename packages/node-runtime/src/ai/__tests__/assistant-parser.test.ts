import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseAssistantFile, serializeAssistant } from '../assistant-parser'

describe('parseAssistantFile', () => {
  it('normalizes legacy session tool names in allowedBuiltinTools', () => {
    const config = parseAssistantFile(
      `---
id: legacy_tools
name: Legacy Tools
allowedBuiltinTools:
  - get_session_messages
  - get_session_summaries
  - keyword_frequency
---
Use selected tools.`,
      'legacy_tools.md'
    )

    assert.ok(config)
    assert.deepEqual(config.allowedBuiltinTools, ['get_segment_messages', 'get_segment_summaries', 'keyword_frequency'])
  })

  it('preserves builtin template tracking metadata', () => {
    const serialized = serializeAssistant({
      id: 'general_cn',
      name: '通用助手',
      systemPrompt: '自然地回答。',
      presetQuestions: [],
      builtinId: 'general_cn',
      builtinVersion: 2,
      builtinDigest: 'digest-v2',
    })
    const config = parseAssistantFile(serialized, 'general_cn.md')

    assert.ok(config)
    assert.equal(config.builtinVersion, 2)
    assert.equal(config.builtinDigest, 'digest-v2')
  })
})
