import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as afterPendingCallbacks } from 'node:timers/promises'
import type { ImportTarget } from '@/services'
import { createImportTargetModalChoice, createImportTargetQuestion } from './importTargetChoice'

const STILL_WAITING = 'still waiting'

/**
 * ImportArea.vue and its ImportTargetModal, bound the way the template binds them:
 * `v-model:open`, `@confirm` and `@cancel`. Every change of `open` runs the modal's
 * watch on that prop. `question.ask()` is the wait inside `askImportTarget()`.
 */
function mountImportTargetModal() {
  let open = false
  const emitted: Array<'confirm' | 'cancel'> = []
  const question = createImportTargetQuestion(() => setOpen(true))
  const modal = createImportTargetModalChoice({
    close: () => setOpen(false),
    confirm: (target) => {
      emitted.push('confirm')
      question.confirm(target)
    },
    cancel: () => {
      emitted.push('cancel')
      question.cancel()
    },
  })

  function setOpen(value: boolean) {
    if (value === open) return
    open = value
    modal.openChanged(value)
  }

  return { question, modal, emitted, setOpen }
}

/**
 * Closing the modal any way other than its footer buttons used to leave the import
 * that asked for a target waiting forever. The modal stays mounted across imports,
 * so the openings below run one after another on the same instance.
 */
test('each opening of the import target modal gives the waiting import one answer, however the modal is closed', async () => {
  const { question, modal, emitted, setOpen } = mountImportTargetModal()
  const openings: Array<{
    closedWith: string
    close: () => void
    answer: ImportTarget | null
    emitted: Array<'confirm' | 'cancel'>
  }> = [
    {
      closedWith: 'the confirm button',
      close: () => modal.confirm({ mode: 'new' }),
      answer: { mode: 'new' },
      emitted: ['confirm'],
    },
    {
      // UModal handles these three alike: reka-ui's DialogClose and its dismiss handler only write `open = false`.
      closedWith: 'Escape, a click outside the modal or the close button in its header',
      close: () => setOpen(false),
      answer: null,
      emitted: ['cancel'],
    },
    {
      closedWith: 'the cancel button',
      close: () => modal.cancel(),
      answer: null,
      emitted: ['cancel'],
    },
  ]

  for (const opening of openings) {
    emitted.length = 0
    const asked = question.ask()
    opening.close()
    const answer = await Promise.race([asked, afterPendingCallbacks(STILL_WAITING)])
    assert.deepEqual(
      { answer, emitted },
      { answer: opening.answer, emitted: opening.emitted },
      `closed with ${opening.closedWith}`
    )
  }
})
