/**
 * Preferences HTTP routes — /_web/preferences/*
 *
 * Read/write preferences.json and config.toml [ui] section for Web UI.
 */

import type { FastifyInstance } from 'fastify'
import type { RuntimeRouteContext } from '../../context/runtime'
import type { ServiceRouteContext } from '../../context/services'
import { PreferencesManager, type Preferences } from '@openchatlab/node-runtime'
import { loadConfig, writeConfigField, type UiConfig } from '@openchatlab/config'

type PreferencesRouteContext = Pick<RuntimeRouteContext, 'pathProvider'> &
  Pick<ServiceRouteContext, 'preferencesManager'>

export function registerPreferencesRoutes(server: FastifyInstance, ctx: PreferencesRouteContext): void {
  const prefManager = ctx.preferencesManager ?? new PreferencesManager(ctx.pathProvider.getSystemDir())

  server.get('/_web/preferences', async () => {
    return prefManager.load()
  })

  server.patch<{ Body: Partial<Preferences> }>('/_web/preferences', async (request) => {
    return prefManager.save(request.body)
  })

  server.get('/_web/preferences/ui-config', async () => {
    const config = loadConfig()
    return config.ui
  })

  server.patch<{ Body: Partial<UiConfig> }>('/_web/preferences/ui-config', async (request) => {
    try {
      for (const [key, value] of Object.entries(request.body)) {
        if (value !== undefined) {
          writeConfigField('ui', key, value as string | number)
        }
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  server.get('/_web/preferences/locale', async () => {
    const config = loadConfig()
    return { lang: config.locale.lang }
  })

  server.patch<{ Body: { lang: string } }>('/_web/preferences/locale', async (request) => {
    try {
      writeConfigField('locale', 'lang', request.body.lang)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
