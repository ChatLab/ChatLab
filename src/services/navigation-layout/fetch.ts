import type { NavigationLayout } from '@openchatlab/shared-types'
import { del, get, put } from '../utils/http'
import type { NavigationLayoutAdapter } from './types'

export class FetchNavigationLayoutAdapter implements NavigationLayoutAdapter {
  load(): ReturnType<NavigationLayoutAdapter['load']> {
    return get('/navigation-layout')
  }

  save(layout: NavigationLayout): ReturnType<NavigationLayoutAdapter['save']> {
    return put('/navigation-layout', layout)
  }

  reset(): ReturnType<NavigationLayoutAdapter['reset']> {
    return del('/navigation-layout')
  }
}
