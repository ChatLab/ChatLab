import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_TOOL_CATALOG } from '@openchatlab/core'
import { DEFAULT_GENERAL_ASSISTANT_CONFIGS } from '../default-assistants'

describe('default general assistants', () => {
  it('enable every analysis tool by default', () => {
    const analysisToolNames = BUILTIN_TOOL_CATALOG.filter((tool) => tool.category === 'analysis')
      .map((tool) => tool.name)
      .sort()

    for (const config of DEFAULT_GENERAL_ASSISTANT_CONFIGS) {
      assert.deepEqual([...(config.allowedBuiltinTools ?? [])].sort(), analysisToolNames, config.id)
    }
  })
})
