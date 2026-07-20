import { _api as iconifyAPI } from '@iconify/vue'

// All icons used by the app are registered by virtual:nuxt-icon-bundle/register.
// Disable Iconify's fallback fetcher so an unbundled dynamic name cannot contact a CDN.
iconifyAPI.setFetch(undefined as unknown as typeof globalThis.fetch)
