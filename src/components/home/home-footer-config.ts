export type HomeFooterConfigSource = 'cache-only' | 'platform' | 'network'

export interface HomeFooterConfigSourceOptions {
  remoteConfigEnabled: boolean
  isElectron: boolean
}

export function resolveHomeFooterConfigSource(options: HomeFooterConfigSourceOptions): HomeFooterConfigSource {
  if (!options.remoteConfigEnabled) return 'cache-only'
  return options.isElectron ? 'platform' : 'network'
}
