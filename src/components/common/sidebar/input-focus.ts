export interface ExposedInputRef {
  inputRef: Pick<HTMLInputElement, 'focus' | 'select'> | null
}

export function focusExposedInput(component: ExposedInputRef | null, options: { select?: boolean } = {}): boolean {
  const input = component?.inputRef
  if (!input) return false

  input.focus()
  if (options.select) input.select()
  return true
}
