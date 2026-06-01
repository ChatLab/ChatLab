import { getRegisteredAdapter } from '../registry'
import type { CacheServiceAdapter } from './types'

export function useCacheService(): CacheServiceAdapter {
  return getRegisteredAdapter<CacheServiceAdapter>('cache')
}
