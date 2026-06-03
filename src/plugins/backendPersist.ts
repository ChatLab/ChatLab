/**
 * Pinia Backend Persist Plugin
 *
 * Declarative configuration for syncing store fields to preferences.json.
 * Stores use `backendPersist: { pick: [...] }` to opt-in.
 *
 * Usage in store:
 *   backendPersist: { pick: ['field1', 'field2'] }
 *   backendPersist: { pick: ['schemes', 'defaultSchemeId'], key: 'wordFilter' }
 *
 * The `key` option nests all picked fields under that key in preferences.json.
 */

import type { PiniaPlugin } from 'pinia'
import { watch } from 'vue'
import type { Preferences } from '@openchatlab/shared-types'

export interface BackendPersistConfig {
  /** Store fields to persist */
  pick: string[]
  /** Nest picked fields under this key in preferences.json */
  key?: string
  /** Serialize store state before saving to preferences.json */
  serialize?: (store: Record<string, unknown>) => Partial<Preferences>
}

declare module 'pinia' {
  interface DefineStoreOptionsBase<S, Store> {
    backendPersist?: BackendPersistConfig
  }
}

type SaveFn = (partial: Partial<Preferences>) => Promise<unknown>

const stores: Map<string, { store: ReturnType<any>; config: BackendPersistConfig }> = new Map()
let saveFn: SaveFn | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingSave: Record<string, unknown> = {}

function flushSave() {
  if (!saveFn || Object.keys(pendingSave).length === 0) return
  const toSave = { ...pendingSave }
  pendingSave = {}
  saveFn(toSave as Partial<Preferences>).catch((err) => {
    console.warn('[BackendPersist] Save failed:', err)
  })
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, 500)
}

function collectAndQueue(store: Record<string, unknown>, config: BackendPersistConfig) {
  if (config.serialize) {
    Object.assign(pendingSave, config.serialize(store))
    scheduleSave()
    return
  }

  const data: Record<string, unknown> = {}
  for (const field of config.pick) {
    data[field] = JSON.parse(JSON.stringify(store[field]))
  }
  if (config.key) {
    pendingSave[config.key] = data
  } else {
    Object.assign(pendingSave, data)
  }
  scheduleSave()
}

/**
 * Call once after services are initialized to enable write-back.
 */
export function initBackendPersist(fn: SaveFn): void {
  saveFn = fn
}

/**
 * Hydrate all registered stores from backend preferences data.
 */
export function hydrateAllStores(prefs: Preferences): void {
  for (const [, { store, config }] of stores) {
    const source = config.key
      ? (prefs as unknown as Record<string, unknown>)[config.key]
      : (prefs as unknown as Record<string, unknown>)
    if (!source || typeof source !== 'object') continue

    const patch: Record<string, unknown> = {}
    for (const field of config.pick) {
      const val = (source as Record<string, unknown>)[field]
      if (val !== undefined) patch[field] = val
    }
    if (Object.keys(patch).length > 0) {
      store.$patch(patch)
    }
  }
}

export const backendPersistPlugin: PiniaPlugin = ({ store, options }) => {
  const config = options.backendPersist
  if (!config) return

  stores.set(store.$id, { store, config })

  for (const field of config.pick) {
    watch(
      () => store.$state[field],
      () => collectAndQueue(store.$state, config),
      { deep: true }
    )
  }
}
