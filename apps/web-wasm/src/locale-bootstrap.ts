import { detectSystemLocale, isValidLocale, setLocale, type LocaleType } from '@/i18n'
import { WEB_WASM_LOCALE_STORAGE_KEY } from '@/services/preferences/browser'

export function resolveWebWasmInitialLocale(
  savedLocale: string | null | undefined,
  browserLanguages?: readonly string[]
): LocaleType {
  return savedLocale && isValidLocale(savedLocale) ? savedLocale : detectSystemLocale(browserLanguages)
}

export function initializeWebWasmLocale(): LocaleType {
  let savedLocale: string | null = null
  try {
    savedLocale = globalThis.localStorage?.getItem(WEB_WASM_LOCALE_STORAGE_KEY) ?? null
  } catch {
    // Storage may be unavailable in hardened browser contexts; browser language remains a safe default.
  }

  const locale = resolveWebWasmInitialLocale(savedLocale)
  setLocale(locale)
  return locale
}
