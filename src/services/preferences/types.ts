/**
 * Preferences Service Types
 *
 * Re-exports shared types from @openchatlab/shared-types
 * and defines adapter interface for platform-specific implementations.
 */

export type {
  Preferences,
  AIGlobalSettings,
  AIPreprocessConfig,
  WordFilterScheme,
  KeywordTemplate,
  DesensitizeRule,
  UiConfig,
} from '@openchatlab/shared-types'

import type { Preferences, UiConfig } from '@openchatlab/shared-types'

export interface PreferencesAdapter {
  getPreferences(): Promise<Preferences>
  savePreferences(partial: Partial<Preferences>): Promise<{ success: boolean; error?: string }>
  getUiConfig(): Promise<UiConfig>
  saveUiConfig(partial: Partial<UiConfig>): Promise<{ success: boolean; error?: string }>
  getLocale(): Promise<string>
  saveLocale(lang: string): Promise<{ success: boolean; error?: string }>
}
