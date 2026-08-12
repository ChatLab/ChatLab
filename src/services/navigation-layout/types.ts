import type { NavigationLayout, NavigationLayoutLoadResult } from '@openchatlab/shared-types'

export interface NavigationLayoutAdapter {
  load(): Promise<NavigationLayoutLoadResult>
  save(layout: NavigationLayout): Promise<{ status: 'saved'; layout: NavigationLayout }>
  reset(): Promise<{ status: 'missing'; layout: null }>
}
