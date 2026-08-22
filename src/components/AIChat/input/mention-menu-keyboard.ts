export type MentionMenuKeyboardAction = 'pass' | 'activate' | 'block' | 'activate-and-block'

export function resolveMentionMenuKeyboardAction(params: {
  key: string
  isComposing: boolean
  hasKeyboardSelection: boolean
}): MentionMenuKeyboardAction {
  if (params.isComposing || params.hasKeyboardSelection) return 'pass'
  if (params.key === 'ArrowDown') return 'activate-and-block'
  if (params.key === 'ArrowUp') return 'activate'
  if (params.key === 'Enter' || params.key === 'Tab') return 'block'
  return 'pass'
}
