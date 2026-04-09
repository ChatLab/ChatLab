const LOCALE_PATH_MAP: Record<string, string> = {
  'en-US': 'en',
  'zh-TW': 'zh-TW',
  'ja-JP': 'ja',
}

/**
 * 将应用 locale 转为 chatlab.fun 站点的路径前缀。
 * zh-CN 为默认语言，返回空字符串（无前缀）。
 */
export function getChatlabSiteLocalePath(locale: string): string {
  return LOCALE_PATH_MAP[locale] ?? ''
}
