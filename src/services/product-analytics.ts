import type { AnalyticsEventName } from '@openchatlab/shared-types'
import { getLocale } from '@/i18n'
import { usePlatformService } from './platform/service'

export function trackProductEvent(eventName: AnalyticsEventName, properties?: Record<string, unknown>): void {
  try {
    void usePlatformService()
      .trackAnalyticsEvent(eventName, { ...properties, app_locale: getLocale() })
      .catch(() => {})
  } catch {
    // Analytics is best-effort and may run before the platform adapter is registered in tests or early startup.
  }
}
