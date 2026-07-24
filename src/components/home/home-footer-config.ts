export type HomeFooterConfigSource = 'cache-only' | 'platform' | 'network'

export interface HomeFooterConfigSourceOptions {
  remoteConfigEnabled: boolean
  isElectron: boolean
}

export function resolveHomeFooterConfigSource(options: HomeFooterConfigSourceOptions): HomeFooterConfigSource {
  if (!options.remoteConfigEnabled) return 'cache-only'
  return options.isElectron ? 'platform' : 'network'
}

export function filterHomeFooterLinks<T extends { id: string; action?: string }>(
  links: readonly T[],
  showChangelog: boolean
): T[] {
  if (showChangelog) return [...links]
  return links.filter((link) => link.id !== 'changelog' && link.action !== 'changelog')
}
