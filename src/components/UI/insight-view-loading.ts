import { inject, onBeforeUnmount, watch } from 'vue'
import type { InjectionKey, Ref } from 'vue'

export interface InsightViewLoadingCoordinator {
  register: () => () => void
  suppress?: Readonly<Ref<boolean>>
}

export interface InsightViewLoadingBinding {
  sync: (loading: boolean) => void
  dispose: () => void
}

export const insightViewLoadingCoordinatorKey: InjectionKey<InsightViewLoadingCoordinator> = Symbol(
  'insight-view-loading-coordinator'
)

export function createInsightViewLoadingBinding(
  coordinator: InsightViewLoadingCoordinator | null
): InsightViewLoadingBinding {
  let unregister: (() => void) | null = null

  function release() {
    unregister?.()
    unregister = null
  }

  return {
    sync(loading) {
      if (loading) {
        if (!unregister && coordinator) unregister = coordinator.register()
        return
      }
      release()
    },
    dispose: release,
  }
}

export function useInsightViewLoading(loading: Readonly<Ref<boolean>>): InsightViewLoadingCoordinator | null {
  const coordinator = inject(insightViewLoadingCoordinatorKey, null)
  const binding = createInsightViewLoadingBinding(coordinator)

  watch(loading, (value) => binding.sync(value), { immediate: true, flush: 'sync' })
  onBeforeUnmount(binding.dispose)

  return coordinator
}
