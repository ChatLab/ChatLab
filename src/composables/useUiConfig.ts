/**
 * Reactive UI Config backed by config.toml [ui] section.
 *
 * Values are hydrated from backend during initPreferencesSync().
 */

import { ref } from 'vue'
import type { UiConfig } from '@/services/preferences/types'

export type SummaryStrategy = 'brief' | 'standard'

const _uiConfig = ref<UiConfig>({
  default_session_tab: 'insights',
  session_gap_threshold: 1800,
  summary_strategy: 'standard',
})

export function getUiConfig(): UiConfig {
  return _uiConfig.value
}

export function setUiConfig(config: UiConfig): void {
  _uiConfig.value = config
}

export function patchUiConfig(partial: Partial<UiConfig>): void {
  _uiConfig.value = { ..._uiConfig.value, ...partial }
}

export function getSessionGapThreshold(): number {
  return _uiConfig.value.session_gap_threshold
}

export function getSummaryStrategy(): SummaryStrategy {
  return _uiConfig.value.summary_strategy ?? 'standard'
}
