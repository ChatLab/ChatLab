import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { useProgressiveChatHistory } from './useProgressiveChatHistory'
import type { QAPair } from '../utils/chatMessages'

function createPairs(count: number): QAPair[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `pair-${index}`,
    user: null,
    assistant: null,
    standalone: null,
  }))
}

test('starts with the latest 20 pairs and reveals older history in batches', async () => {
  const scope = effectScope()
  const pairs = ref(createPairs(45))
  const conversationId = ref<string | null>('conversation-a')
  const container = ref<HTMLElement | null>(null)
  const history = scope.run(() => useProgressiveChatHistory(pairs, conversationId, container))!

  assert.deepEqual(
    history.visiblePairs.value.map((pair) => pair.id),
    createPairs(45)
      .slice(-20)
      .map((pair) => pair.id)
  )
  await history.loadOlderPairs()
  assert.equal(history.visiblePairs.value.length, 40)
  await history.loadOlderPairs()
  assert.equal(history.visiblePairs.value.length, 45)
  assert.equal(history.hasOlderPairs.value, false)

  scope.stop()
})

test('preserves the visible anchor when older pairs are inserted above', async () => {
  const scope = effectScope()
  const pairs = ref(createPairs(45))
  const conversationId = ref<string | null>('conversation-a')
  const container = ref<HTMLElement | null>(null)
  const history = scope.run(() => useProgressiveChatHistory(pairs, conversationId, container))!
  const element = {
    scrollTop: 120,
    get scrollHeight() {
      return history.visiblePairs.value.length * 100
    },
  } as HTMLElement
  container.value = element

  await history.loadOlderPairs()

  assert.equal(element.scrollTop, 2_120)
  scope.stop()
})

test('resets the window when switching conversations', async () => {
  const scope = effectScope()
  const pairs = ref(createPairs(10))
  const conversationId = ref<string | null>('conversation-a')
  const container = ref<HTMLElement | null>(null)
  const history = scope.run(() => useProgressiveChatHistory(pairs, conversationId, container))!

  assert.equal(history.visiblePairs.value.length, 10)
  conversationId.value = 'conversation-b'
  pairs.value = createPairs(45)
  await nextTick()

  assert.equal(history.visiblePairs.value.length, 20)
  scope.stop()
})
