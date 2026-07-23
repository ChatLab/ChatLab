import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import './style.css'

type DocsLocale = 'en' | 'cn' | 'tw'

const LANGUAGE_PREFERENCE_KEY = 'chatlab-docs-language'

function getLocaleFromPath(path: string): DocsLocale {
  if (path === '/cn' || path.startsWith('/cn/')) return 'cn'
  if (path === '/tw' || path.startsWith('/tw/')) return 'tw'
  return 'en'
}

function getBrowserLocale(): DocsLocale {
  const languages = navigator.languages.length > 0 ? navigator.languages : [navigator.language]

  for (const language of languages) {
    const normalized = language.toLowerCase()
    if (/^zh-(tw|hk|mo|hant)/.test(normalized)) return 'tw'
    if (normalized.startsWith('zh')) return 'cn'
  }

  return 'en'
}

function readPreferredLocale(): DocsLocale | null {
  try {
    const locale = localStorage.getItem(LANGUAGE_PREFERENCE_KEY)
    return locale === 'en' || locale === 'cn' || locale === 'tw' ? locale : null
  } catch {
    return null
  }
}

function savePreferredLocale(locale: DocsLocale): void {
  try {
    localStorage.setItem(LANGUAGE_PREFERENCE_KEY, locale)
  } catch {
    // Language preference persistence is optional.
  }
}

export default {
  extends: DefaultTheme,
  enhanceApp({ router }) {
    if (typeof window === 'undefined') return

    const initialPath = window.location.pathname
    if (initialPath === '/') {
      const preferredLocale = readPreferredLocale() ?? getBrowserLocale()
      if (preferredLocale !== 'en') {
        window.location.replace(`/${preferredLocale}/${window.location.search}${window.location.hash}`)
        return
      }
    }

    savePreferredLocale(getLocaleFromPath(initialPath))
    router.onAfterRouteChange = (to) => {
      savePreferredLocale(getLocaleFromPath(to))
    }
  },
} satisfies Theme
