import fs from 'node:fs'
import path from 'node:path'
import { isNameMatchPlatform } from '@openchatlab/core'
import type {
  ChatPlatform,
  ContactOverride,
  ContactOverridePatch,
  ContactTier,
  OwnerMatchMode,
} from '@openchatlab/shared-types'
import { appLogger } from '../logging/app-logger'

export type ContactsOverrides = Record<string, ContactOverride>

export interface BuildContactOverrideKeyInput {
  platform: ChatPlatform
  platformId: string
  sessionId?: string
  matchMode?: OwnerMatchMode
}

const OVERRIDES_FILE = 'contacts-overrides.json'
const VALID_CONTACT_TIERS: ReadonlySet<ContactTier> = new Set([
  'core',
  'friend',
  'acquaintance',
  'high_interaction',
  'medium_interaction',
  'low_interaction',
])

export function buildContactOverrideKey(input: BuildContactOverrideKeyInput): string {
  const platform = input.platform.trim()
  const platformId = input.platformId.trim()
  if (!platform) throw new Error('platform is required')
  if (!platformId) throw new Error('platformId is required')

  const sessionScoped = input.matchMode === 'name' || isNameMatchPlatform(platform)
  if (!sessionScoped) return `${platform}:${platformId}`

  const sessionId = input.sessionId?.trim()
  if (!sessionId) throw new Error('sessionId is required for session-scoped contact override keys')
  return `${platform}:${sessionId}:${platformId}`
}

export class ContactsOverridesManager {
  private readonly filePath: string

  constructor(systemDir: string) {
    this.filePath = path.join(systemDir, OVERRIDES_FILE)
  }

  getFilePath(): string {
    return this.filePath
  }

  load(): ContactsOverrides {
    if (!fs.existsSync(this.filePath)) return {}

    let raw = ''
    try {
      raw = fs.readFileSync(this.filePath, 'utf-8')
      return normalizeOverrides(JSON.parse(raw))
    } catch (error) {
      this.backupCorruptFile(raw)
      appLogger.warn('contacts', 'contacts overrides file is corrupt', error)
      return {}
    }
  }

  saveOverride(key: string, patch: ContactOverridePatch): ContactOverride {
    const overrides = this.load()
    const current = overrides[key] ?? {}
    const next = normalizeOverride({
      ...current,
      ...patch,
      updatedAt: Date.now(),
    })

    overrides[key] = next
    this.writeOverrides(overrides)
    return next
  }

  deleteOverride(key: string): void {
    const overrides = this.load()
    delete overrides[key]
    this.writeOverrides(overrides)
  }

  getSignaturePart(): string {
    try {
      const stat = fs.statSync(this.filePath)
      return `${Math.floor(stat.mtimeMs)}:${stat.size}`
    } catch {
      return '-'
    }
  }

  private writeOverrides(overrides: ContactsOverrides): void {
    const dir = path.dirname(this.filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify(overrides, null, 2)}\n`, 'utf-8')
      fs.renameSync(tempPath, this.filePath)
    } catch (error) {
      try {
        fs.rmSync(tempPath, { force: true })
      } catch {
        // ignore cleanup failures; the original write error is the actionable one
      }
      throw error
    }
  }

  private backupCorruptFile(raw: string): void {
    try {
      const backupDir = path.join(path.dirname(this.filePath), 'backups')
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupPath = path.join(backupDir, `contacts-overrides-corrupt-${timestamp}.json`)
      fs.writeFileSync(backupPath, raw, 'utf-8')
    } catch (error) {
      appLogger.warn('contacts', 'failed to back up corrupt contacts overrides file', error)
    }
  }
}

function normalizeOverrides(value: unknown): ContactsOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const result: ContactsOverrides = {}
  for (const [key, override] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) continue
    if (!override || typeof override !== 'object' || Array.isArray(override)) continue
    result[key] = normalizeOverride(override as ContactOverride)
  }
  return result
}

function normalizeOverride(override: ContactOverride): ContactOverride {
  const normalized: ContactOverride = {}

  if (override.lockedTier === null || isValidContactTier(override.lockedTier)) {
    normalized.lockedTier = override.lockedTier
  }
  if (typeof override.updatedAt === 'number' && Number.isFinite(override.updatedAt)) {
    normalized.updatedAt = override.updatedAt
  }

  return normalized
}

function isValidContactTier(value: unknown): value is ContactTier {
  return typeof value === 'string' && VALID_CONTACT_TIERS.has(value as ContactTier)
}
