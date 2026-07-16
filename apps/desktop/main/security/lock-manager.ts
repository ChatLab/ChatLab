/**
 * 应用锁管理器
 *
 * 统一管理应用锁全生命周期：
 * - 锁配置的读取、写入、持久化
 * - 锁定/解锁状态机
 * - 触发场景：启动、闲置超时、窗口失焦
 * - 锁定 Flag 文件（崩溃后重启仍强制锁屏）
 * - 锁屏窗口的创建与管理
 *
 * 安全设计：
 * - 配置存储在 ~/.chatlab/settings/app-lock.json
 * - 密码 PBKDF2-SHA512 单向哈希存储，不可逆
 * - 锁定状态用 Flag 文件 + 内存状态双重保证
 * - 配置写入：先写盘成功再更新内存，磁盘异常不污染内存状态
 * - 崩溃恢复：启动时检测 Flag 文件，若存在则强制锁屏
 */

import { BrowserWindow } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { getSettingsDir } from '../paths'
import { logger } from '../logger'
import {
  hashPassword,
  verifyAppPassword as verifyAppPasswordHash,
  verifyPasswordWithCooldown,
  resetCooldown,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  evaluatePasswordStrength,
  type PasswordHash,
  type PasswordStrength,
} from './crypto-utils'
import {
  checkWindowsHelloAvailability,
  verifyWithWindowsHello,
  isWindowsHelloAvailable,
  type WindowsHelloAvailability,
} from './windows-hello'

// ==================== 类型定义 ====================

/** 解锁模式 */
export type UnlockMode = 'password' | 'windows-hello'

/** 闲置超时选项 (分钟) */
export const IDLE_TIMEOUT_OPTIONS = [1, 3, 5, 10, 15, 30, 60] as const

/** 锁配置 */
export interface LockConfig {
  /** 是否启用应用锁 */
  enabled: boolean
  /** 解锁模式 */
  unlockMode: UnlockMode
  /** 闲置超时自动锁定 (分钟)，0 表示不自动锁定 */
  idleTimeoutMinutes: number
  /** 窗口失焦时是否立即锁定 */
  lockOnBlur: boolean
  /** 启动时是否立即要求解锁 */
  lockOnStartup: boolean
}

/** 锁状态 */
export type LockState = 'unlocked' | 'locked' | 'configuring'

/** 解锁请求结果 */
export interface UnlockResult {
  success: boolean
  /** 需要设置新密码（首次使用或重置后） */
  needsSetup?: boolean
  /** 密码错误 */
  wrongPassword?: boolean
  /** 需要冷却 */
  cooldown?: boolean
  /** 冷却剩余时间 (秒) */
  cooldownRemaining?: number
  /** 剩余重试次数 */
  remainingRetries?: number
  /** Windows Hello 不可用 */
  windowsHelloUnavailable?: boolean
  /** 用户取消 */
  cancelled?: boolean
  /** 错误信息 */
  error?: string
}

/** 密码修改结果 */
export interface PasswordChangeResult {
  success: boolean
  error?: string
  /** 新密码强度 */
  strength?: PasswordStrength
}

// ==================== 常量 ====================

/** 锁配置文件路径（相对于 settings 目录） */
const LOCK_CONFIG_FILE = 'app-lock.json'

/** 锁定 Flag 文件（用于崩溃恢复检测） */
const LOCK_FLAG_FILE = '.app-lock-flag'

/** 默认锁配置 */
const DEFAULT_LOCK_CONFIG: LockConfig = {
  enabled: false,
  unlockMode: 'password',
  idleTimeoutMinutes: 5,
  lockOnBlur: false,
  lockOnStartup: true,
}

// ==================== 单例状态 ====================

/** 当前锁状态 */
let lockState: LockState = 'unlocked'

/** 当前锁配置（内存缓存） */
let currentConfig: LockConfig = { ...DEFAULT_LOCK_CONFIG }

/** 密码哈希（单向不可逆） */
let storedPasswordHash: PasswordHash | null = null

/** 闲置计时器 */
let idleTimer: ReturnType<typeof setTimeout> | null = null

/** 最后用户活动时间 */
let lastActivityTime = Date.now()

/** 是否正在锁定/解锁中（防止并发） */
let isTransitioning = false

/** 主窗口引用 */
let mainWindowRef: BrowserWindow | null = null

// ==================== 配置持久化 ====================

/**
 * 获取锁配置文件绝对路径
 */
function getLockConfigPath(): string {
  return join(getSettingsDir(), LOCK_CONFIG_FILE)
}

/**
 * 获取锁定 Flag 文件路径
 */
function getLockFlagPath(): string {
  return join(getSettingsDir(), LOCK_FLAG_FILE)
}

/**
 * 加载锁配置
 */
function loadConfig(): LockConfig {
  try {
    const configPath = getLockConfigPath()
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8')
      const data = JSON.parse(raw)

      // 合并默认值（防御性：防止配置文件被手动编辑后缺少字段）
      const config: LockConfig = {
        ...DEFAULT_LOCK_CONFIG,
        enabled: typeof data.enabled === 'boolean' ? data.enabled : DEFAULT_LOCK_CONFIG.enabled,
        unlockMode:
          data.unlockMode === 'password' || data.unlockMode === 'windows-hello'
            ? data.unlockMode
            : DEFAULT_LOCK_CONFIG.unlockMode,
        idleTimeoutMinutes:
          typeof data.idleTimeoutMinutes === 'number' && data.idleTimeoutMinutes > 0
            ? data.idleTimeoutMinutes
            : DEFAULT_LOCK_CONFIG.idleTimeoutMinutes,
        lockOnBlur:
          typeof data.lockOnBlur === 'boolean' ? data.lockOnBlur : DEFAULT_LOCK_CONFIG.lockOnBlur,
        lockOnStartup:
          typeof data.lockOnStartup === 'boolean' ? data.lockOnStartup : DEFAULT_LOCK_CONFIG.lockOnStartup,
      }

      // 读取密码凭证（兼容旧版可逆加密 + 新版单向哈希）
      if (data.passwordHash && data.passwordHash.version === 2) {
        storedPasswordHash = data.passwordHash
      } else if (data.encryptedPassword) {
        // 旧版可逆密文 — 加载后在下一次密码验证成功时自动迁移
        storedPasswordHash = null
        logger.info('App lock: legacy encrypted password detected, will migrate on next verification')
      }

      return config
    }
  } catch (error) {
    logger.error(`Failed to load lock config: ${error instanceof Error ? error.message : String(error)}`)
  }

  return { ...DEFAULT_LOCK_CONFIG }
}

/**
 * 保存锁配置到磁盘（先写盘，成功后才更新内存）
 * @returns true 写入成功，false 写入失败（内存状态未修改）
 */
function saveConfig(config: LockConfig, passwordHash: PasswordHash | null): boolean {
  try {
    const configPath = getLockConfigPath()
    const dir = getSettingsDir()
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const toSave: Record<string, unknown> = { ...config }
    if (passwordHash) {
      toSave.passwordHash = passwordHash
    }

    fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2), 'utf-8')
    return true
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to save lock config: ${errMsg}`)
    return false
  }
}

/**
 * 写入锁定 Flag 文件（崩溃恢复用）
 */
function setLockFlag(): void {
  try {
    const flagPath = getLockFlagPath()
    fs.writeFileSync(flagPath, Date.now().toString(), 'utf-8')
  } catch (error) {
    logger.error(`Failed to write lock flag: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 清除锁定 Flag 文件
 */
function clearLockFlag(): void {
  try {
    const flagPath = getLockFlagPath()
    if (fs.existsSync(flagPath)) {
      fs.unlinkSync(flagPath)
    }
  } catch (error) {
    logger.error(`Failed to clear lock flag: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 检查锁定 Flag 文件（崩溃恢复检测）
 */
function checkLockFlag(): boolean {
  try {
    const flagPath = getLockFlagPath()
    return fs.existsSync(flagPath)
  } catch {
    return false
  }
}

// ==================== 锁屏窗口管理 ====================

/**
 * 发送锁屏覆盖层显示/隐藏指令到渲染进程
 * 覆盖层以 DOM 最高 z-index 遮罩的形式覆盖主窗口内容区
 */
function sendOverlayCommand(command: 'show' | 'hide'): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('app-lock:overlay-command', { command })
  }
}

// ==================== 锁定/解锁状态机 ====================

/**
 * 初始化锁管理器
 *
 * 在 app.whenReady() 后调用。
 * 检测崩溃恢复 Flag、加载配置、注册事件监听。
 *
 * @param mainWindow 主窗口引用
 */
export function initLockManager(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow

  // 加载配置
  currentConfig = loadConfig()

  // 兜底校验：锁已启用但没有密码 → 自动回滚禁用
  validateAndSanitizeConfig()

  // 崩溃恢复检测
  const wasLocked = checkLockFlag()

  logger.info(
    `App lock initialized: enabled=${currentConfig.enabled}, wasLocked=${wasLocked}, mode=${currentConfig.unlockMode}`
  )

  // 如果锁已启用且在启动时需要锁定（或崩溃恢复），则立即锁定
  if (currentConfig.enabled && storedPasswordHash && (currentConfig.lockOnStartup || wasLocked)) {
    lockApp()
  }

  // 注册活动监听
  registerActivityListeners()

  // 如果配置了闲置超时，启动计时器
  if (currentConfig.enabled && currentConfig.idleTimeoutMinutes > 0) {
    startIdleTimer()
  }
}

/**
 * 锁定应用
 *
 * 流程：
 * 1. 写入 Flag 文件（崩溃恢复）
 * 2. 切换状态为 locked
 * 3. 创建/显示锁屏窗口
 * 4. 通知主窗口
 */
export function lockApp(): void {
  if (lockState === 'locked') return
  if (isTransitioning) return

  // 安全兜底：锁未启用或无密码，拒绝锁定
  if (!currentConfig.enabled || !storedPasswordHash) {
    logger.warn('App lock: lockApp() called but lock disabled or no password — refusing to lock')
    return
  }

  isTransitioning = true
  setLockFlag()
  lockState = 'locked'

  logger.info('App locked')

  // 创建锁屏窗口
  try {
    sendOverlayCommand('show')
  } catch (error) {
    logger.error(`Failed to create lock window: ${error instanceof Error ? error.message : String(error)}`)
  }

  // 通知渲染进程
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('app-lock-state-changed', { locked: true })
  }

  isTransitioning = false
}

/**
 * 解锁应用
 *
 * @returns UnlockResult 解锁结果
 */
export async function unlockApp(credentials?: {
  password?: string
  useWindowsHello?: boolean
}): Promise<UnlockResult> {
  if (lockState === 'unlocked') {
    return { success: true }
  }

  if (isTransitioning) {
    return { success: false, error: '正在处理中，请稍后' }
  }

  isTransitioning = true

  try {
    // 检查是否需要首次设置密码
    if (!storedPasswordHash) {
      return { success: false, needsSetup: true, error: '请先设置应用锁密码' }
    }

    // Windows Hello 模式：必须用户配置中已启用 Hello，不允许调用方强制覆盖
    if (credentials?.useWindowsHello && currentConfig.unlockMode === 'windows-hello') {
      const helloResult = await verifyWithWindowsHello('请验证您的身份以解锁 ChatLab')

      if (helloResult.notAvailable) {
        return {
          success: false,
          windowsHelloUnavailable: true,
          error: helloResult.error || 'Windows Hello 不可用，请使用密码解锁',
        }
      }

      if (!helloResult.verified) {
        return {
          success: false,
          cancelled: helloResult.cancelled,
          error: helloResult.error || '验证失败',
        }
      }

      // Windows Hello 验证通过
      doUnlock()
      return { success: true }
    }

    // 密码模式
    if (credentials?.password) {
      // 安全擦除：密码字符串稍后由 GC 回收前被覆盖
      const pwd = credentials.password

      const verifyResult = verifyPasswordWithCooldown(pwd, storedPasswordHash!)

      if (verifyResult.cooldown) {
        return {
          success: false,
          cooldown: true,
          cooldownRemaining: verifyResult.cooldownRemaining,
          error: verifyResult.error,
        }
      }

      if (!verifyResult.verified) {
        return {
          success: false,
          wrongPassword: true,
          remainingRetries: verifyResult.remainingRetries,
          error: verifyResult.error,
        }
      }

      // 密码验证通过
      doUnlock()
      return { success: true }
    }

    return { success: false, error: '请提供解锁凭据' }
  } finally {
    isTransitioning = false
  }
}

/**
 * 执行解锁操作（内部）
 */
function doUnlock(): void {
  clearLockFlag()
  lockState = 'unlocked'
  resetCooldown()
  stopIdleTimer()
  sendOverlayCommand('hide')

  logger.info('App unlocked')

  // 重新启动闲置计时器
  if (currentConfig.enabled && currentConfig.idleTimeoutMinutes > 0) {
    startIdleTimer()
  }

  // 通知渲染进程
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('app-lock-state-changed', { locked: false })
  }
}

// ==================== 密码管理 ====================

/**
 * 设置新密码（仅用于首次初始化，无历史密码场景）
 *
 * 安全规则：
 * - 锁屏状态下禁止修改密码
 * - 已有密码时拒绝直接覆盖，必须走 changePassword 校验旧密码
 * - 先写盘成功，再更新内存状态
 */
export function setPassword(newPassword: string): PasswordChangeResult {
  // 锁屏状态下禁止修改密码
  if (lockState === 'locked') {
    return { success: false, error: '请先解锁应用' }
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { success: false, error: `密码长度不能少于 ${MIN_PASSWORD_LENGTH} 位` }
  }

  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return { success: false, error: `密码长度不能超过 ${MAX_PASSWORD_LENGTH} 位` }
  }

  // 已有密码时拒绝直接覆盖，必须走 changePassword
  if (storedPasswordHash) {
    return { success: false, error: '已有密码，请使用修改密码功能' }
  }

  try {
    const hashed = hashPassword(newPassword)
    // 先写盘
    if (!saveConfig(currentConfig, hashed)) {
      return { success: false, error: '密码保存失败' }
    }
    // 写盘成功才更新内存
    storedPasswordHash = hashed
    resetCooldown()
    logger.info('App lock password hash stored')
    return { success: true, strength: evaluatePasswordStrength(newPassword) }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to set password: ${errMsg}`)
    return { success: false, error: '密码设置失败' }
  }
}

/**
 * 修改密码
 *
 * @param oldPassword 旧密码
 * @param newPassword 新密码
 * @returns PasswordChangeResult
 */
export function changePassword(oldPassword: string, newPassword: string): PasswordChangeResult {
  if (!storedPasswordHash) {
    return { success: false, error: '尚未设置密码' }
  }

  // 验证旧密码
  const verifyResult = verifyPasswordWithCooldown(oldPassword, storedPasswordHash)
  if (!verifyResult.verified) {
    return {
      success: false,
      error: verifyResult.error || '旧密码错误',
    }
  }

  // 新密码不得等于旧密码
  if (oldPassword === newPassword) {
    return { success: false, error: '新密码不能与旧密码相同' }
  }

  // 锁屏状态下禁止修改密码
  if (lockState === 'locked') {
    return { success: false, error: '请先解锁应用' }
  }

  // 设置新密码（先写盘，成功后再更新内存）
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { success: false, error: `密码长度不能少于 ${MIN_PASSWORD_LENGTH} 位` }
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return { success: false, error: `密码长度不能超过 ${MAX_PASSWORD_LENGTH} 位` }
  }

  try {
    const hashed = hashPassword(newPassword)
    if (!saveConfig(currentConfig, hashed)) {
      return { success: false, error: '密码保存失败' }
    }
    storedPasswordHash = hashed
    resetCooldown()
    logger.info('App lock password changed')
    return { success: true, strength: evaluatePasswordStrength(newPassword) }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to change password: ${errMsg}`)
    return { success: false, error: '密码修改失败' }
  }
}

/**
 * 重置密码（清除应用锁）
 *
 * ⚠️ 仅可在已解锁状态下调用。
 * 如果用户在锁屏状态忘记了密码，需要通过其他方式处理。
 */
export function resetAppLockPassword(): { success: boolean; error?: string } {
  // 锁屏状态下禁止重置
  if (lockState === 'locked') {
    return { success: false, error: '请先解锁应用' }
  }

  try {
    const newConfig = { ...currentConfig, enabled: false, unlockMode: 'password' as const }
    // 先写盘
    if (!saveConfig(newConfig, null)) {
      return { success: false, error: '配置保存失败' }
    }
    // 写盘成功才更新内存
    storedPasswordHash = null
    currentConfig = newConfig
    resetCooldown()
    clearLockFlag()

    logger.warn('App lock password reset — Hello unbound')
    return { success: true }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to reset password: ${errMsg}`)
    return { success: false, error: '重置密码失败' }
  }
}

// ==================== 配置管理 ====================

/**
 * 获取当前锁配置
 */
export function getLockConfig(): LockConfig & {
  hasPassword: boolean
  windowsHelloAvailable: boolean
} {
  return {
    ...currentConfig,
    hasPassword: storedPasswordHash !== null,
    windowsHelloAvailable: false, // 异步填充
  }
}

/**
 * 获取异步锁配置（含 Windows Hello 可用性）
 */
export async function getLockConfigAsync(): Promise<
  LockConfig & {
    hasPassword: boolean
    windowsHelloAvailable: boolean
  }
> {
  const helloAvailable = await isWindowsHelloAvailable()

  // 如果 Windows Hello 不可用但当前模式设为 windows-hello，自动降级
  if (!helloAvailable && currentConfig.unlockMode === 'windows-hello') {
    const fallbackConfig = { ...currentConfig, unlockMode: 'password' as const }
    if (saveConfig(fallbackConfig, storedPasswordHash)) {
      currentConfig = fallbackConfig
      logger.info('Windows Hello unavailable, auto-fallback to password mode')
    }
  }

  return {
    ...currentConfig,
    hasPassword: storedPasswordHash !== null,
    windowsHelloAvailable: helloAvailable,
  }
}

/**
 * 更新锁配置
 *
 * @param updates 部分配置更新
 * @returns 更新后的完整配置
 */
export async function updateLockConfig(
  updates: Partial<LockConfig>
): Promise<{ success: boolean; config?: LockConfig & { hasPassword: boolean; windowsHelloAvailable: boolean }; error?: string }> {
  // 验证 Windows Hello 可用性（如果尝试切换到该模式）
  if (updates.unlockMode === 'windows-hello') {
    const helloAvailable = await isWindowsHelloAvailable()
    if (!helloAvailable) {
      return { success: false, error: '此设备不支持 Windows Hello' }
    }
  }

  // 安全校验：尝试启用锁但没有密码 → 拒绝
  if (updates.enabled === true && !storedPasswordHash) {
    return { success: false, error: '请先设置应用锁密码' }
  }

  // 安全校验：锁定状态下禁止修改解锁模式或 Hello 配置，防止绕过密码
  if (lockState === 'locked') {
    if (updates.unlockMode !== undefined || updates.enabled !== undefined) {
      return { success: false, error: '请先解锁应用' }
    }
  }

  // 合并配置（临时变量，写盘成功后再更新 currentConfig）
  const newConfig: LockConfig = { ...currentConfig, ...updates }

  // 如果关闭了应用锁，清除锁定状态
  if (updates.enabled === false) {
    stopIdleTimer()
  }

  // 先写盘
  if (!saveConfig(newConfig, storedPasswordHash)) {
    return { success: false, error: '配置保存失败' }
  }
  // 写盘成功才更新内存
  currentConfig = newConfig

  // 回读校验：若启用 Hello，确认配置已落盘
  if (currentConfig.unlockMode === 'windows-hello') {
    const reRead = loadConfig()
    if (reRead.unlockMode !== 'windows-hello') {
      logger.error('Lock config: Failed to persist Hello enable — readback mismatch')
      currentConfig = { ...currentConfig, unlockMode: 'password' }
      saveConfig(currentConfig, storedPasswordHash)
      return { success: false, error: '配置保存失败，请重试' }
    }
    logger.info('Lock config: Hello enable verified via readback')
  }

  // 重新管理计时器
  if (currentConfig.enabled && currentConfig.idleTimeoutMinutes > 0) {
    stopIdleTimer()
    startIdleTimer()
  } else {
    stopIdleTimer()
  }

  logger.info(`Lock config updated: ${JSON.stringify(updates)}`)

  return {
    success: true,
    config: {
      ...currentConfig,
      hasPassword: storedPasswordHash !== null,
      windowsHelloAvailable: await isWindowsHelloAvailable(),
    },
  }
}

/**
 * 纯密码校验：仅比对哈希，不依赖锁屏解锁状态。
 * 用于 Windows Hello 开户等需要验证密码但不应触发解锁的场景。
 */
export function verifyAppPassword(rawPassword: string): boolean {
  if (!storedPasswordHash) return false
  return verifyAppPasswordHash(rawPassword, storedPasswordHash)
}

/**
 * 获取当前锁状态
 */
export function getLockState(): LockState {
  return lockState
}

/**
 * 全局锁定状态查询 — 供其他 IPC 模块校验是否拦截数据访问
 */
export function isAppLocked(): boolean {
  return lockState === 'locked'
}

/**
 * 重新启用已关闭的锁（密码未变，仅恢复 enabled=true）
 * 用于关闭锁后再次开启的场景，不修改密码哈希与 Hello 配置
 */
export function reEnableLock(oldPassword: string): { success: boolean; error?: string } {
  if (!storedPasswordHash) {
    return { success: false, error: '尚未设置密码' }
  }
  if (lockState === 'locked') {
    return { success: false, error: '请先解锁应用' }
  }
  if (!verifyAppPasswordHash(oldPassword, storedPasswordHash)) {
    return { success: false, error: '密码错误' }
  }
  const newConfig: LockConfig = { ...currentConfig, enabled: true }
  if (!saveConfig(newConfig, storedPasswordHash)) {
    return { success: false, error: '配置保存失败' }
  }
  currentConfig = newConfig
  if (currentConfig.idleTimeoutMinutes > 0) startIdleTimer()
  logger.info('App lock re-enabled')
  return { success: true }
}

/**
 * 获取 Windows Hello 可用性（供 IPC 调用）
 */
export async function getWindowsHelloStatus(): Promise<WindowsHelloAvailability> {
  return checkWindowsHelloAvailability()
}

/**
 * Windows Hello 绑定验证（双重校验流程）
 *
 * 前置条件：调用方必须先验证应用密码通过，再调用此函数。
 * 调用系统原生验证弹窗，成功后将 Hello 可用性缓存刷新为 true，
 * 确保后续 updateLockConfig 中的 isWindowsHelloAvailable() 命中缓存。
 *
 * @returns verified=true 表示系统验证通过，可继续更新配置
 */
export async function verifyHelloForEnroll(message: string): Promise<{
  success: boolean; verified: boolean; cancelled: boolean; notAvailable: boolean; error?: string
}> {
  const result = await verifyWithWindowsHello(message)

  // 系统验证成功 → 强制刷新缓存为 available，确保后续配置写入不因缓存失效被拦截
  if (result.verified) {
    await isWindowsHelloAvailable() // 触发 checkWindowsHelloAvailability 并缓存结果
  }

  return {
    success: result.success,
    verified: result.verified,
    cancelled: result.cancelled ?? false,
    notAvailable: result.notAvailable ?? false,
    error: result.error,
  }
}

/**
 * 安全兜底校验：锁已启用但没有密码 → 自动回滚禁用
 * 防止配置损坏或手动篡改导致的无密码锁死
 */
function validateAndSanitizeConfig(): void {
  if (currentConfig.enabled && !storedPasswordHash) {
    logger.warn('App lock: enabled=true but no password hash — auto-disabling lock')
    const sanitized = { ...currentConfig, enabled: false }
    if (saveConfig(sanitized, null)) {
      currentConfig = sanitized
    }
  }
}

// ==================== 闲置检测 ====================

/**
 * 注册用户活动监听
 */
function registerActivityListeners(): void {
  if (!mainWindowRef) return

  // 监听主窗口的焦点和输入事件
  mainWindowRef.on('focus', () => {
    lastActivityTime = Date.now()
  })

  // 失焦锁定
  mainWindowRef.on('blur', () => {
    lastActivityTime = Date.now()
    if (currentConfig.enabled && currentConfig.lockOnBlur && lockState === 'unlocked') {
      lockApp()
    }
  })
}

/**
 * 启动闲置计时器
 */
function startIdleTimer(): void {
  stopIdleTimer()

  const timeoutMs = currentConfig.idleTimeoutMinutes * 60 * 1000

  idleTimer = setInterval(() => {
    const idleDuration = Date.now() - lastActivityTime
    if (idleDuration >= timeoutMs && lockState === 'unlocked' && currentConfig.enabled) {
      logger.info(`App locked due to idle timeout (${currentConfig.idleTimeoutMinutes} min)`)
      lockApp()
    }
  }, 10000) // 每 10 秒检查一次
}

/**
 * 停止闲置计时器
 */
function stopIdleTimer(): void {
  if (idleTimer) {
    clearInterval(idleTimer)
    idleTimer = null
  }
}

/**
 * 更新最后活动时间（由渲染进程调用，监听用户交互）
 */
export function reportUserActivity(): void {
  lastActivityTime = Date.now()
}

// ==================== 清理 ====================

/**
 * 清理锁管理器资源
 *
 * 在 app.will-quit 时调用。
 */
export function cleanupLockManager(): void {
  stopIdleTimer()
  sendOverlayCommand('hide')
  logger.info('Lock manager cleaned up')
}
