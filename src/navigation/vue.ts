import { inject, onBeforeUnmount, shallowRef, type App, type InjectionKey, type ShallowRef } from 'vue'
import type { NavigationLayoutController, NavigationLayoutSnapshot } from './layout'

const NAVIGATION_LAYOUT_KEY: InjectionKey<NavigationLayoutController> = Symbol('NavigationLayoutController')

export function installNavigationLayout(app: App, controller: NavigationLayoutController): void {
  app.provide(NAVIGATION_LAYOUT_KEY, controller)
}

export function useNavigationLayout(): {
  controller: NavigationLayoutController
  snapshot: Readonly<ShallowRef<NavigationLayoutSnapshot>>
} {
  const controller = inject(NAVIGATION_LAYOUT_KEY)
  if (!controller) throw new Error('Navigation layout controller is unavailable')
  const snapshot = shallowRef(controller.getSnapshot())
  const unsubscribe = controller.subscribe(() => {
    snapshot.value = controller.getSnapshot()
  })
  onBeforeUnmount(unsubscribe)
  return { controller, snapshot }
}
