import type { DesktopCloseBehavior } from '@openchatlab/shared-types'

export type WindowsCloseAction = Exclude<DesktopCloseBehavior, 'ask'> | 'cancel'

export interface WindowsClosePromptResult {
  action: WindowsCloseAction
  remember: boolean
}

interface WindowsCloseControllerDependencies {
  readPreference: () => DesktopCloseBehavior
  savePreference: (preference: Exclude<DesktopCloseBehavior, 'ask'>) => void
  prompt: () => Promise<WindowsClosePromptResult>
  enterBackground: () => void
  quit: () => void
  onError: (error: unknown) => void
}

export class WindowsCloseController {
  private handling = false

  constructor(private readonly dependencies: WindowsCloseControllerDependencies) {}

  async requestClose(): Promise<void> {
    if (this.handling) return
    this.handling = true

    try {
      const preference = this.readPreference()
      const result = preference === 'ask' ? await this.prompt() : { action: preference, remember: false }

      if (result.action === 'cancel') return

      if (result.remember) {
        try {
          this.savePreference(result.action)
        } catch (error) {
          this.onError(error)
        }
      }

      if (result.action === 'background') {
        this.enterBackground()
      } else {
        this.quit()
      }
    } catch (error) {
      this.onError(error)
    } finally {
      this.handling = false
    }
  }

  private readPreference(): DesktopCloseBehavior {
    try {
      return this.dependencies.readPreference()
    } catch (error) {
      this.dependencies.onError(error)
      return 'ask'
    }
  }

  private prompt(): Promise<WindowsClosePromptResult> {
    return this.dependencies.prompt()
  }

  private savePreference(preference: Exclude<DesktopCloseBehavior, 'ask'>): void {
    this.dependencies.savePreference(preference)
  }

  private enterBackground(): void {
    this.dependencies.enterBackground()
  }

  private quit(): void {
    this.dependencies.quit()
  }

  private onError(error: unknown): void {
    this.dependencies.onError(error)
  }
}
