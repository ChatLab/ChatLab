export interface LanguageBootstrapResult {
  shouldOpenLanguageModal: boolean
  shouldContinue: boolean
}

/**
 * 根据后端保存的语言配置决定首次启动弹窗流程。
 * 空语言代表新用户，需要先完成语言选择，避免用户协议和语言弹窗同时打开。
 */
export function resolveLanguageBootstrap(savedLocale: string | null | undefined): LanguageBootstrapResult {
  const hasSavedLocale = Boolean(savedLocale)
  return {
    shouldOpenLanguageModal: !hasSavedLocale,
    shouldContinue: hasSavedLocale,
  }
}
