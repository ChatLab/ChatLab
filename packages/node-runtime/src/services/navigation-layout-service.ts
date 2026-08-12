import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  NAVIGATION_LAYOUT_SCHEMA_VERSION,
  type NavigationLayout,
  type NavigationLayoutLoadResult,
  type NavigationLayoutPrimaryItem,
} from '@openchatlab/shared-types'
import { appLogger } from '../logging/app-logger'

const NAVIGATION_LAYOUT_FILE = 'navigation-layout.json'

export class NavigationLayoutValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NavigationLayoutValidationError'
  }
}

export interface NavigationLayoutService {
  load(): NavigationLayoutLoadResult
  save(input: unknown): NavigationLayout
  reset(): void
}

export function createNavigationLayoutService(systemDir: string): NavigationLayoutService {
  const settingsDir = path.join(systemDir, 'settings')
  const filePath = path.join(settingsDir, NAVIGATION_LAYOUT_FILE)

  return {
    load() {
      if (!fs.existsSync(filePath)) return { status: 'missing', layout: null }
      try {
        const layout = normalizeNavigationLayout(JSON.parse(fs.readFileSync(filePath, 'utf-8')))
        return { status: 'saved', layout }
      } catch (error) {
        appLogger.warn('navigation-layout', 'Saved navigation layout is invalid; using plugin defaults', error)
        return { status: 'invalid', layout: null }
      }
    },

    save(input) {
      const layout = normalizeNavigationLayout(input)
      fs.mkdirSync(settingsDir, { recursive: true })
      const tempPath = path.join(settingsDir, `.navigation-layout.${process.pid}.${Date.now()}.tmp`)
      try {
        fs.writeFileSync(tempPath, `${JSON.stringify(layout, null, 2)}\n`, 'utf-8')
        fs.renameSync(tempPath, filePath)
      } finally {
        if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true })
      }
      appLogger.info('navigation-layout', 'Navigation layout saved')
      return layout
    },

    reset() {
      if (fs.existsSync(filePath)) fs.rmSync(filePath)
      appLogger.info('navigation-layout', 'Navigation layout reset to plugin defaults')
    },
  }
}

export function normalizeNavigationLayout(input: unknown): NavigationLayout {
  const record = requireRecord(input, 'layout')
  if (record.schemaVersion !== NAVIGATION_LAYOUT_SCHEMA_VERSION) {
    throw new NavigationLayoutValidationError(
      `Unsupported navigation layout schema version: ${String(record.schemaVersion)}`
    )
  }
  if (!Array.isArray(record.primary))
    throw new NavigationLayoutValidationError('Navigation layout primary must be an array')
  if (!Array.isArray(record.hiddenEntryIds)) {
    throw new NavigationLayoutValidationError('Navigation layout hiddenEntryIds must be an array')
  }

  const groupIds = new Set<string>()
  const visibleEntryIds = new Set<string>()
  const primary = record.primary.map((item, index) => normalizePrimaryItem(item, index, groupIds, visibleEntryIds))
  const hiddenEntryIds = normalizeUniqueIds(record.hiddenEntryIds, 'hiddenEntryIds')
  for (const entryId of hiddenEntryIds) {
    if (visibleEntryIds.has(entryId)) {
      throw new NavigationLayoutValidationError(`Navigation entry "${entryId}" cannot be both visible and hidden`)
    }
  }

  return { schemaVersion: NAVIGATION_LAYOUT_SCHEMA_VERSION, primary, hiddenEntryIds }
}

function normalizePrimaryItem(
  input: unknown,
  index: number,
  groupIds: Set<string>,
  visibleEntryIds: Set<string>
): NavigationLayoutPrimaryItem {
  const item = requireRecord(input, `primary[${index}]`)
  if (item.kind === 'entry') {
    const entryId = requireId(item.entryId, `primary[${index}].entryId`)
    addUnique(visibleEntryIds, entryId, 'navigation entry')
    return { kind: 'entry', entryId }
  }
  if (item.kind === 'group') {
    const id = requireId(item.id, `primary[${index}].id`)
    addUnique(groupIds, id, 'navigation group')
    if (typeof item.title !== 'string' || item.title.trim().length === 0) {
      throw new NavigationLayoutValidationError(`primary[${index}].title must be a non-empty string`)
    }
    if (!Array.isArray(item.children)) {
      throw new NavigationLayoutValidationError(`primary[${index}].children must be an array`)
    }
    const children = normalizeUniqueIds(item.children, `primary[${index}].children`)
    for (const entryId of children) addUnique(visibleEntryIds, entryId, 'navigation entry')
    return { kind: 'group', id, title: item.title, children }
  }
  throw new NavigationLayoutValidationError(`primary[${index}].kind must be "entry" or "group"`)
}

function normalizeUniqueIds(input: unknown[], field: string): string[] {
  const ids = new Set<string>()
  return input.map((value, index) => {
    const id = requireId(value, `${field}[${index}]`)
    addUnique(ids, id, field)
    return id
  })
}

function requireRecord(input: unknown, field: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new NavigationLayoutValidationError(`${field} must be an object`)
  }
  return input as Record<string, unknown>
}

function requireId(input: unknown, field: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new NavigationLayoutValidationError(`${field} must be a non-empty string`)
  }
  return input
}

function addUnique(ids: Set<string>, id: string, field: string): void {
  if (ids.has(id)) throw new NavigationLayoutValidationError(`Duplicate ${field} "${id}"`)
  ids.add(id)
}
