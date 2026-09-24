import type { ImportTarget } from '@/services'

/**
 * The import area's side of the import target modal: open the modal and wait
 * for its answer. The first answer wins; null means the user cancelled the import.
 */
export function createImportTargetQuestion(openModal: () => void) {
  let resolveAnswer: ((target: ImportTarget | null) => void) | null = null

  function answer(target: ImportTarget | null): void {
    resolveAnswer?.(target)
    resolveAnswer = null
  }

  return {
    ask(): Promise<ImportTarget | null> {
      openModal()
      return new Promise((resolve) => {
        resolveAnswer = resolve
      })
    },
    confirm: (target: ImportTarget) => answer(target),
    cancel: () => answer(null),
  }
}

/**
 * The modal's side. UModal closes on Escape, a click outside and its header close
 * button by only writing `open = false`, so closing before a choice is a cancel.
 * The footer buttons record their answer before they close the modal, so that
 * close adds no second answer.
 */
export function createImportTargetModalChoice(emit: {
  close: () => void
  confirm: (target: ImportTarget) => void
  cancel: () => void
}) {
  let awaitingChoice = false

  return {
    /** Call whenever the modal's `open` prop changes. */
    openChanged(open: boolean): void {
      if (open) {
        awaitingChoice = true
      } else if (awaitingChoice) {
        awaitingChoice = false
        emit.cancel()
      }
    },
    confirm(target: ImportTarget): void {
      awaitingChoice = false
      emit.close()
      emit.confirm(target)
    },
    cancel(): void {
      awaitingChoice = false
      emit.close()
      emit.cancel()
    },
  }
}
