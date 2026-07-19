export function handleWebWasmPageHide(event: Pick<PageTransitionEvent, 'persisted'>, disposeRuntime: () => void): void {
  if (event.persisted) return
  disposeRuntime()
}
