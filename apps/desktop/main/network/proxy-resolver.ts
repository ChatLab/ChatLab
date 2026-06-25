/**
 * Convert Electron's `session.resolveProxy()` result to a model download proxy URL.
 * Electron returns entries like `DIRECT`, `PROXY host:port`, `HTTPS host:port`;
 * HTTP(S) proxies can be used directly by the model downloader. SOCKS entries
 * are still returned so the downloader can fail explicitly instead of going direct.
 */
export function proxyUrlFromElectronResolvedProxy(resolvedProxy: string): string | undefined {
  let firstSocksProxyUrl: string | undefined

  for (const rawRule of resolvedProxy.split(';')) {
    const rule = rawRule.trim()
    if (!rule) continue
    if (rule.toUpperCase() === 'DIRECT') return undefined

    const [schemeRaw, targetRaw] = rule.split(/\s+/, 2)
    const scheme = schemeRaw?.toUpperCase()
    const target = targetRaw?.trim()
    if (!scheme || !target) continue

    if (scheme === 'PROXY' || scheme === 'HTTP') return target.includes('://') ? target : `http://${target}`
    if (scheme === 'HTTPS') return target.includes('://') ? target : `https://${target}`
    if (scheme === 'SOCKS' && !firstSocksProxyUrl) {
      firstSocksProxyUrl = target.includes('://') ? target : `socks://${target}`
    }
    if (scheme === 'SOCKS4' && !firstSocksProxyUrl) {
      firstSocksProxyUrl = target.includes('://') ? target : `socks4://${target}`
    }
    if (scheme === 'SOCKS5' && !firstSocksProxyUrl) {
      firstSocksProxyUrl = target.includes('://') ? target : `socks5://${target}`
    }
  }
  return firstSocksProxyUrl
}
