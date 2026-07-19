import { IS_ELECTRON, IS_WEB_WASM } from './platform'

const LOCALE_PATH_MAP: Record<string, string> = {
  'en-US': 'en',
  'zh-CN': 'cn',
  'zh-TW': 'tw',
  'ja-JP': 'ja',
}

/**
 * chatlab.fun 的基础 URL。
 * Electron 与 Web WASM 直接访问远程；CLI Web 通过 Vite dev proxy 避免 CORS。
 */
export function resolveChatlabSiteBase(flags: { isElectron: boolean; isWebWasm: boolean }): string {
  return flags.isElectron || flags.isWebWasm ? 'https://chatlab.fun' : '/_proxy/chatlab.fun'
}

export const CHATLAB_SITE_BASE = resolveChatlabSiteBase({
  isElectron: IS_ELECTRON,
  isWebWasm: IS_WEB_WASM,
})

/**
 * 将应用 locale 转为 chatlab.fun 站点的路径前缀。
 */
export function getChatlabSiteLocalePath(locale: string): string {
  return LOCALE_PATH_MAP[locale] ?? ''
}

/**
 * 官网跳转统一使用根路径，并通过 query 传递语言参数。
 * 例如：?lang=cn / ?lang=en
 */
export function getChatlabSiteLangQuery(locale: string): string {
  const lang = LOCALE_PATH_MAP[locale]
  return lang ? `?lang=${lang}` : ''
}
