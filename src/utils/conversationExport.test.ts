import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getExportableConversationMessages, hasExportableConversationMessages } from './conversationExport'

describe('conversationExport', () => {
  it('treats visible user and assistant messages as exportable before an aiChatId exists', () => {
    const messages = [
      { role: 'summary' as const, content: 'internal summary', timestamp: 1 },
      { role: 'user' as const, content: 'hello', timestamp: 2 },
      { role: 'assistant' as const, content: 'hi there', timestamp: 3 },
    ]

    assert.equal(hasExportableConversationMessages(messages), true)
    assert.deepEqual(getExportableConversationMessages(messages), [
      { role: 'user', content: 'hello', timestamp: 2 },
      { role: 'assistant', content: 'hi there', timestamp: 3 },
    ])
  })

  it('does not export internal or blank messages', () => {
    const messages = [
      { role: 'summary' as const, content: 'internal summary', timestamp: 1 },
      { role: 'assistant' as const, content: '   ', timestamp: 2 },
    ]

    assert.equal(hasExportableConversationMessages(messages), false)
    assert.deepEqual(getExportableConversationMessages(messages), [])
  })
})
