import { onScopeDispose, watch, type Ref } from 'vue'
import { trackProductEvent } from '@/services/product-analytics'

/** Counts deliberate tab visits, not default/restored selection or time in the background. */
export function useInsightTabAnalytics(options: {
  chatType: 'group' | 'private'
  isActive: () => boolean
  sessionId: Ref<string | null>
  routePath: () => string
}) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pendingView = false

  function cancel() {
    clearTimeout(timer)
    timer = undefined
  }

  const isForeground = () => document.visibilityState === 'visible' && document.hasFocus()

  function reportPendingView() {
    if (!pendingView || !options.isActive() || !options.sessionId.value || !isForeground()) return
    pendingView = false
    trackProductEvent('insight_viewed', { chat_type: options.chatType })
  }

  function selectTab(tabId: string) {
    cancel()
    if (!options.isActive() || !isForeground()) return
    timer = setTimeout(() => {
      timer = undefined
      if (options.isActive() && isForeground()) {
        // A window may stay open across days; qualify this period's denominator as well.
        trackProductEvent('insight_viewed', { chat_type: options.chatType })
        trackProductEvent('insight_tab_used', { chat_type: options.chatType, tab_id: tabId })
      }
    }, 3000)
  }

  watch(
    [options.isActive, options.sessionId],
    ([active, sessionId]) => {
      cancel()
      // Separate denominator: old clients without sub-tab tracking must not dilute its adoption rate.
      pendingView = Boolean(active && sessionId)
      reportPendingView()
    },
    { immediate: true, flush: 'sync' }
  )

  function onVisibilityChange() {
    if (document.visibilityState !== 'visible') cancel()
    else reportPendingView()
  }
  window.addEventListener('blur', cancel)
  window.addEventListener('focus', reportPendingView)
  // Cancel as soon as navigation commits, before an outgoing page transition finishes.
  watch(
    options.routePath,
    () => {
      cancel()
      pendingView = false
    },
    { flush: 'sync' }
  )
  document.addEventListener('visibilitychange', onVisibilityChange)
  onScopeDispose(() => {
    cancel()
    window.removeEventListener('blur', cancel)
    window.removeEventListener('focus', reportPendingView)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return selectTab
}
