import { getRegisteredAdapter } from '../registry'
import type { NavigationLayoutAdapter } from './types'

export function useNavigationLayoutService(): NavigationLayoutAdapter {
  return getRegisteredAdapter<NavigationLayoutAdapter>('navigation-layout')
}
