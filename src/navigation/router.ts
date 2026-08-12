import type { Router } from 'vue-router'
import { listResolvedNavigationEntries, type NavigationLayoutController } from './layout'

export async function redirectFromHiddenInsightPage(
  router: Router,
  controller: NavigationLayoutController
): Promise<void> {
  const currentPageId = String(router.currentRoute.value.meta.insightPageId ?? '')
  if (!currentPageId) return
  const visibleEntries = listResolvedNavigationEntries(controller.getResolvedLayout())
  if (visibleEntries.some(({ page }) => page.id === currentPageId)) return

  const fallback = visibleEntries[0]
  await router.replace(fallback ? { name: fallback.page.routeName } : { name: 'home' })
}
