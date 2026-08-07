import type { DesktopCloseBehavior } from '@openchatlab/shared-types'

interface WindowsCloseBehaviorDependencies {
  readPreference: () => DesktopCloseBehavior
  enterBackground: () => void
  quit: () => void
  onError: (error: unknown) => void
}

export function applyWindowsCloseBehavior(dependencies: WindowsCloseBehaviorDependencies): void {
  try {
    if (dependencies.readPreference() === 'background') {
      dependencies.enterBackground()
    } else {
      dependencies.quit()
    }
  } catch (error) {
    dependencies.onError(error)
  }
}
