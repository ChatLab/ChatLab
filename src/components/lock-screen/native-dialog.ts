export interface NativeDialogController {
  readonly open: boolean
  showModal: () => void
  close: () => void
}

export function syncNativeDialog(dialog: NativeDialogController | null, shouldOpen: boolean): void {
  if (!dialog || dialog.open === shouldOpen) return

  if (shouldOpen) dialog.showModal()
  else dialog.close()
}
