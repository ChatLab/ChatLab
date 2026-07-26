export async function runWithSavingState<T>(
  setSaving: (saving: boolean) => void,
  operation: () => Promise<T>
): Promise<T> {
  setSaving(true)
  try {
    return await operation()
  } finally {
    setSaving(false)
  }
}
