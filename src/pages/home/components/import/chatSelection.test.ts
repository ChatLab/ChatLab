import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createDefaultSelectedChatIds, toggleAllChatIds, toggleSelectedChatId } from './chatSelection'

const chats = [
  {
    chatId: 'empty',
    name: 'Empty',
    type: 'private' as const,
    messageCount: 0,
    memberCount: 2,
  },
  {
    chatId: 'active',
    name: 'Active',
    type: 'group' as const,
    messageCount: 5,
    memberCount: 3,
  },
]

describe('prepared chat selection', () => {
  it('selects non-empty chats by default', () => {
    assert.deepEqual(createDefaultSelectedChatIds(chats), new Set(['active']))
  })

  it('explicit select-all includes empty chats and a second toggle clears selection', () => {
    const all = toggleAllChatIds(new Set(['active']), chats)
    assert.deepEqual(all, new Set(['empty', 'active']))
    assert.deepEqual(toggleAllChatIds(all, chats), new Set())
  })

  it('toggles by stable chatId instead of list index', () => {
    const selected = toggleSelectedChatId(new Set(['active']), 'empty')
    assert.deepEqual(selected, new Set(['active', 'empty']))
    assert.deepEqual(toggleSelectedChatId(selected, 'active'), new Set(['empty']))
  })
})
