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
const dirtyFieldsByStore = new Map<string, Set<string>>()
let saveFn: SaveFn | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingSave: Record<string, unknown> = {}
let hydrationSettled = false
let applyingHydration = false
let hydratedPreferences: Preferences | null = null

function flushSave() {
  saveTimer = null
  if (!saveFn || !hydrationSettled || Object.keys(pendingSave).length === 0) return
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
  if (hydrationSettled && Object.keys(pendingSave).length > 0) scheduleSave()
}

function applyStoreHydration(
  storeId: string,
  store: ReturnType<any>,
  config: BackendPersistConfig,
  prefs: Preferences
): void {
  const source = config.key
    ? (prefs as unknown as Record<string, unknown>)[config.key]
    : (prefs as unknown as Record<string, unknown>)
  if (!source || typeof source !== 'object') return

  const dirtyFields = dirtyFieldsByStore.get(storeId)
  const patch: Record<string, unknown> = {}
  for (const field of config.pick) {
    if (dirtyFields?.has(field)) continue
    const val = (source as Record<string, unknown>)[field]
    if (val !== undefined) patch[field] = val
  }
  if (Object.keys(patch).length > 0) {
    store.$patch(patch)
  }
}

function settleHydration(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  pendingSave = {}
  hydrationSettled = true

  // Rebuild queued writes from the merged store state so a pre-hydration edit
  // cannot save default values over unrelated fields loaded from the backend.
  for (const storeId of dirtyFieldsByStore.keys()) {
    const registered = stores.get(storeId)
    if (registered) collectAndQueue(registered.store.$state, registered.config)
  }
  dirtyFieldsByStore.clear()
}

/**
 * Hydrate all registered stores from backend preferences data.
 * Fields changed locally while the request was pending keep their local value.
 */
export function hydrateAllStores(prefs: Preferences): void {
  hydratedPreferences = prefs
  applyingHydration = true
  try {
    for (const [storeId, { store, config }] of stores) {
      applyStoreHydration(storeId, store, config, prefs)
    }
  } finally {
    applyingHydration = false
  }
  settleHydration()
}

/** Mark hydration as complete when backend preferences could not be loaded. */
export function completeBackendPersistHydration(): void {
  settleHydration()
}

export const backendPersistPlugin: PiniaPlugin = ({ store, options }) => {
  const config = options.backendPersist
  if (!config) return

  stores.set(store.$id, { store, config })

  // Stores created lazily after startup still need the already-loaded backend state.
  if (hydrationSettled && hydratedPreferences) {
    applyStoreHydration(store.$id, store, config, hydratedPreferences)
  }

  for (const field of config.pick) {
    watch(
      () => store.$state[field],
      () => {
        if (applyingHydration) return
        if (!hydrationSettled) {
          const dirtyFields = dirtyFieldsByStore.get(store.$id) ?? new Set<string>()
          dirtyFields.add(field)
          dirtyFieldsByStore.set(store.$id, dirtyFields)
        }
        collectAndQueue(store.$state, config)
      },
      { deep: true, flush: 'sync' }
    )
  }
}
