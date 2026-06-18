import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseAssistantFile } from '../assistant-parser'

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
})
