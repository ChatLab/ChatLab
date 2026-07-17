import { powerMonitor, type BrowserWindow } from 'electron'
import * as fs from 'node:fs'
import { join } from 'node:path'
import type {
  AppLockConfig,
  AppLockConfigUpdate,
  AppLockResult,
  AppLockState,
  AppLockUnlockResult,
} from '../../shared/types'
import { logger } from '../logger'
import { getPathProvider } from '../paths/provider'
import { hashPassword, isPasswordHash, verifyPasswordHash, type PasswordHash } from './crypto-utils'

interface LockSettings {
  idleTimeoutMinutes: number
  lockOnStartup: boolean
}

interface UnlockAttemptState {
  failureCount: number
  cooldownUntil: number
}

const LOCK_CONFIG_FILE = 'app-lock.json'
const LOCK_FLAG_FILE = '.app-lock-flag'
const PIN_PATTERN = /^\d{4}$/
const IDLE_CHECK_INTERVAL_MS = 10000
const MAX_UNLOCK_FAILURES = 5
const UNLOCK_COOLDOWN_MS = 30000
const IDLE_TIMEOUT_OPTIONS = new Set([0, 1, 3, 5, 10, 15, 30, 60])
const DEFAULT_LOCK_SETTINGS: LockSettings = {
  idleTimeoutMinutes: 0,
  lockOnStartup: false,
}
const DEFAULT_UNLOCK_ATTEMPTS: UnlockAttemptState = {
  failureCount: 0,
  cooldownUntil: 0,
}

let lockState: AppLockState = 'unlocked'
let currentSettings: LockSettings = { ...DEFAULT_LOCK_SETTINGS }
let storedPasswordHash: PasswordHash | null = null
let unlockAttempts: UnlockAttemptState = { ...DEFAULT_UNLOCK_ATTEMPTS }
let idleTimer: ReturnType<typeof setInterval> | null = null
let isTransitioning = false
let mainWindowRef: BrowserWindow | null = null

function getSettingsDir(): string {
  return getPathProvider().getSettingsDir()
}

function getLockConfigPath(): string {
  return join(getSettingsDir(), LOCK_CONFIG_FILE)
}

function getLockFlagPath(): string {
  return join(getSettingsDir(), LOCK_FLAG_FILE)
}

function isValidIdleTimeout(value: unknown): value is number {
  return typeof value === 'number' && IDLE_TIMEOUT_OPTIONS.has(value)
}

function loadConfig(): boolean {
  currentSettings = { ...DEFAULT_LOCK_SETTINGS }
  storedPasswordHash = null

  try {
    const configPath = getLockConfigPath()
    if (!fs.existsSync(configPath)) return false

    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as unknown
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      logger.warn('App lock config ignored because it is not an object')
      return false
    }

    const record = data as Record<string, unknown>
    const allowedKeys = new Set(['idleTimeoutMinutes', 'lockOnStartup', 'passwordHash'])
    if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
      logger.warn('App lock config ignored because it contains unsupported fields')
      return false
    }
    if (!isValidIdleTimeout(record.idleTimeoutMinutes) || typeof record.lockOnStartup !== 'boolean') {
      logger.warn('App lock config ignored because its settings are invalid')
      return false
    }
    if (record.passwordHash !== undefined && !isPasswordHash(record.passwordHash)) {
      logger.warn('App lock config ignored because its password format is invalid')
      return false
    }

    currentSettings = {
      idleTimeoutMinutes: record.idleTimeoutMinutes,
      lockOnStartup: record.lockOnStartup,
    }
    storedPasswordHash = record.passwordHash ?? null
    return true
  } catch (error) {
    logger.error(`App lock config ignored because it is invalid: ${error instanceof Error ? error.message : error}`)
    return false
  }
}

function saveConfig(settings: LockSettings, passwordHash: PasswordHash | null): boolean {
  const configPath = getLockConfigPath()
  const tempPath = `${configPath}.tmp`

  try {
    fs.mkdirSync(getSettingsDir(), { recursive: true })
    const record: Record<string, unknown> = { ...settings }
    if (passwordHash) record.passwordHash = passwordHash
    fs.writeFileSync(tempPath, JSON.stringify(record, null, 2), 'utf-8')
    fs.renameSync(tempPath, configPath)
    return true
  } catch (error) {
    logger.error(`Failed to save app lock config: ${error instanceof Error ? error.message : error}`)
    try {
      fs.unlinkSync(tempPath)
    } catch {
      // 临时文件可能尚未创建。
    }
    return false
  }
}

function isUnlockAttemptState(value: unknown): value is UnlockAttemptState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    Object.keys(record).every((key) => key === 'failureCount' || key === 'cooldownUntil') &&
    Number.isInteger(record.failureCount) &&
    (record.failureCount as number) >= 0 &&
    (record.failureCount as number) <= MAX_UNLOCK_FAILURES &&
    Number.isSafeInteger(record.cooldownUntil) &&
    (record.cooldownUntil as number) >= 0
  )
}

function saveLockFlag(attemptState: UnlockAttemptState = unlockAttempts): boolean {
  const flagPath = getLockFlagPath()
  const tempPath = `${flagPath}.tmp`

  try {
    fs.mkdirSync(getSettingsDir(), { recursive: true })
    fs.writeFileSync(tempPath, JSON.stringify(attemptState), 'utf-8')
    fs.renameSync(tempPath, flagPath)
    return true
  } catch (error) {
    logger.error(`Failed to write app lock flag: ${error instanceof Error ? error.message : error}`)
    try {
      fs.unlinkSync(tempPath)
    } catch {
      // 临时文件可能尚未创建。
    }
    return false
  }
}

function clearLockFlag(): boolean {
  try {
    const flagPath = getLockFlagPath()
    if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath)
    return true
  } catch (error) {
    logger.error(`Failed to clear app lock flag: ${error instanceof Error ? error.message : error}`)
    return false
  }
}

function loadLockFlag(): boolean {
  unlockAttempts = { ...DEFAULT_UNLOCK_ATTEMPTS }

  try {
    const flagPath = getLockFlagPath()
    if (!fs.existsSync(flagPath)) return false

    try {
      const data = JSON.parse(fs.readFileSync(flagPath, 'utf-8')) as unknown
      if (isUnlockAttemptState(data)) unlockAttempts = data
      else logger.warn('App lock flag contains invalid unlock attempt state')
    } catch (error) {
      logger.warn(`App lock flag contains invalid JSON: ${error instanceof Error ? error.message : error}`)
    }
    return true
  } catch (error) {
    logger.error(`Failed to read app lock flag: ${error instanceof Error ? error.message : error}`)
    return false
  }
}

function isEnabled(): boolean {
  return storedPasswordHash !== null
}

function notifyLockState(): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('app-lock-state-changed', lockState === 'locked')
  }
}

export function initLockManager(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow
  lockState = 'unlocked'
  isTransitioning = false
  unlockAttempts = { ...DEFAULT_UNLOCK_ATTEMPTS }

  const loaded = loadConfig()
  if (!loaded || !isEnabled()) clearLockFlag()
  const wasLocked = isEnabled() && loadLockFlag()

  logger.info(`App lock initialized: enabled=${isEnabled()}, wasLocked=${wasLocked}`)

  if (wasLocked) {
    enterLockedState()
  } else if (isEnabled() && currentSettings.lockOnStartup) {
    lockApp()
  } else if (isEnabled() && currentSettings.idleTimeoutMinutes > 0) {
    startIdleTimer()
  }
}

export function lockApp(): AppLockResult {
  if (lockState === 'locked') return { success: true }
  if (isTransitioning) return { success: false, error: 'busy' }
  if (!isEnabled()) return { success: false, error: 'disabled' }

  isTransitioning = true
  try {
    unlockAttempts = { ...DEFAULT_UNLOCK_ATTEMPTS }
    if (!saveLockFlag()) return { success: false, error: 'save-failed' }
    enterLockedState()
    return { success: true }
  } finally {
    isTransitioning = false
  }
}

function enterLockedState(): void {
  lockState = 'locked'
  stopIdleTimer()
  logger.info('App locked')
  notifyLockState()
}

export async function unlockApp(password: unknown): Promise<AppLockUnlockResult> {
  if (lockState === 'unlocked') return { success: true }
  if (isTransitioning) return { success: false, error: 'busy' }
  if (!storedPasswordHash) return { success: false, error: 'password-not-set' }

  const cooldownRemaining = getUnlockCooldownRemaining()
  if (cooldownRemaining > 0) {
    return { success: false, error: 'too-many-attempts', retryAfterSeconds: cooldownRemaining }
  }
  if (unlockAttempts.cooldownUntil > 0 && !resetUnlockAttempts()) {
    return { success: false, error: 'save-failed' }
  }
  if (typeof password !== 'string' || !PIN_PATTERN.test(password)) {
    return { success: false, error: 'wrong-password', wrongPassword: true }
  }

  isTransitioning = true
  try {
    if (!(await verifyPasswordHash(password, storedPasswordHash))) {
      const retryAfterSeconds = recordUnlockFailure()
      if (retryAfterSeconds === null) return { success: false, error: 'save-failed' }
      if (retryAfterSeconds > 0) {
        return {
          success: false,
          error: 'too-many-attempts',
          wrongPassword: true,
          retryAfterSeconds,
        }
      }
      return { success: false, error: 'wrong-password', wrongPassword: true }
    }

    if (!resetUnlockAttempts()) return { success: false, error: 'save-failed' }
    clearLockFlag()
    lockState = 'unlocked'
    logger.info('App unlocked')
    notifyLockState()
    if (currentSettings.idleTimeoutMinutes > 0) startIdleTimer()
    return { success: true }
  } finally {
    isTransitioning = false
  }
}

function getUnlockCooldownRemaining(): number {
  if (unlockAttempts.cooldownUntil <= Date.now()) return 0
  return Math.ceil((unlockAttempts.cooldownUntil - Date.now()) / 1000)
}

function recordUnlockFailure(): number | null {
  const failureCount = Math.min(unlockAttempts.failureCount + 1, MAX_UNLOCK_FAILURES)
  const nextAttempts: UnlockAttemptState = {
    failureCount,
    cooldownUntil: failureCount >= MAX_UNLOCK_FAILURES ? Date.now() + UNLOCK_COOLDOWN_MS : 0,
  }
  unlockAttempts = nextAttempts

  if (!saveLockFlag(nextAttempts)) return null
  if (nextAttempts.cooldownUntil > 0) {
    logger.warn('App unlock temporarily blocked after repeated PIN failures')
  }
  return getUnlockCooldownRemaining()
}

function resetUnlockAttempts(): boolean {
  if (unlockAttempts.failureCount === 0 && unlockAttempts.cooldownUntil === 0) return true

  const nextAttempts = { ...DEFAULT_UNLOCK_ATTEMPTS }
  if (!saveLockFlag(nextAttempts)) return false
  unlockAttempts = nextAttempts
  return true
}

export async function setPassword(newPassword: unknown): Promise<AppLockResult> {
  if (lockState === 'locked') return { success: false, error: 'locked' }
  if (isTransitioning) return { success: false, error: 'busy' }
  if (typeof newPassword !== 'string' || !PIN_PATTERN.test(newPassword)) {
    return { success: false, error: 'invalid-pin' }
  }
  if (storedPasswordHash) return { success: false, error: 'password-already-set' }

  isTransitioning = true
  try {
    const passwordHash = await hashPassword(newPassword)
    if (!saveConfig(currentSettings, passwordHash)) return { success: false, error: 'save-failed' }
    storedPasswordHash = passwordHash
    unlockAttempts = { ...DEFAULT_UNLOCK_ATTEMPTS }
    if (currentSettings.idleTimeoutMinutes > 0) startIdleTimer()
    logger.info('App lock password initialized')
    return { success: true }
  } catch (error) {
    logger.error(`Failed to set app lock password: ${error instanceof Error ? error.message : error}`)
    return { success: false, error: 'internal-error' }
  } finally {
    isTransitioning = false
  }
}

export async function changePassword(oldPassword: unknown, newPassword: unknown): Promise<AppLockResult> {
  if (lockState === 'locked') return { success: false, error: 'locked' }
  if (isTransitioning) return { success: false, error: 'busy' }
  if (!storedPasswordHash) return { success: false, error: 'password-not-set' }
  if (typeof oldPassword !== 'string' || typeof newPassword !== 'string' || !PIN_PATTERN.test(newPassword)) {
    return { success: false, error: 'invalid-pin' }
  }
  if (oldPassword === newPassword) return { success: false, error: 'same-password' }
  isTransitioning = true

  try {
    if (!(await verifyPasswordHash(oldPassword, storedPasswordHash))) {
      return { success: false, error: 'wrong-password' }
    }
    const passwordHash = await hashPassword(newPassword)
    if (!saveConfig(currentSettings, passwordHash)) return { success: false, error: 'save-failed' }
    storedPasswordHash = passwordHash
    unlockAttempts = { ...DEFAULT_UNLOCK_ATTEMPTS }
    logger.info('App lock password changed')
    return { success: true }
  } catch (error) {
    logger.error(`Failed to change app lock password: ${error instanceof Error ? error.message : error}`)
    return { success: false, error: 'internal-error' }
  } finally {
    isTransitioning = false
  }
}

export function resetAppLockPassword(): AppLockResult {
  if (lockState === 'locked') return { success: false, error: 'locked' }
  if (isTransitioning) return { success: false, error: 'busy' }
  if (!saveConfig(currentSettings, null)) return { success: false, error: 'save-failed' }

  storedPasswordHash = null
  unlockAttempts = { ...DEFAULT_UNLOCK_ATTEMPTS }
  stopIdleTimer()
  clearLockFlag()
  logger.info('App lock disabled and password cleared')
  return { success: true }
}

export function getLockConfig(): AppLockConfig {
  return {
    enabled: isEnabled(),
    ...currentSettings,
  }
}

function parseConfigUpdate(value: unknown): AppLockConfigUpdate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== 'idleTimeoutMinutes' && key !== 'lockOnStartup')) return null

  const updates: AppLockConfigUpdate = {}
  if ('idleTimeoutMinutes' in record) {
    if (!isValidIdleTimeout(record.idleTimeoutMinutes)) return null
    updates.idleTimeoutMinutes = record.idleTimeoutMinutes
  }
  if ('lockOnStartup' in record) {
    if (typeof record.lockOnStartup !== 'boolean') return null
    updates.lockOnStartup = record.lockOnStartup
  }
  return updates
}

export function updateLockConfig(value: unknown): AppLockResult & { config?: AppLockConfig } {
  if (isTransitioning) return { success: false, error: 'busy' }
  const updates = parseConfigUpdate(value)
  if (!updates) return { success: false, error: 'invalid-config' }

  const nextSettings = { ...currentSettings, ...updates }
  if (!saveConfig(nextSettings, storedPasswordHash)) return { success: false, error: 'save-failed' }

  currentSettings = nextSettings
  if (isEnabled() && currentSettings.idleTimeoutMinutes > 0) startIdleTimer()
  else stopIdleTimer()

  logger.info(`App lock config updated: ${JSON.stringify(updates)}`)
  return { success: true, config: getLockConfig() }
}

export function getLockState(): AppLockState {
  return lockState
}

function checkSystemIdle(): void {
  if (!isEnabled() || lockState === 'locked' || currentSettings.idleTimeoutMinutes <= 0) return

  try {
    if (powerMonitor.getSystemIdleTime() >= currentSettings.idleTimeoutMinutes * 60) {
      logger.info(`App idle timeout reached (${currentSettings.idleTimeoutMinutes} min)`)
      lockApp()
    }
  } catch (error) {
    logger.error(`Failed to read system idle time: ${error instanceof Error ? error.message : error}`)
    stopIdleTimer()
  }
}

function startIdleTimer(): void {
  stopIdleTimer()
  idleTimer = setInterval(checkSystemIdle, IDLE_CHECK_INTERVAL_MS)
  checkSystemIdle()
}

function stopIdleTimer(): void {
  if (!idleTimer) return
  clearInterval(idleTimer)
  idleTimer = null
}

export function cleanupLockManager(): void {
  stopIdleTimer()
  mainWindowRef = null
  logger.info('App lock manager cleaned up')
}
