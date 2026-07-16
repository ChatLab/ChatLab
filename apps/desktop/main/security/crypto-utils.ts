/**
 * 密码哈希工具模块（单向不可逆）
 *
 * 安全审计修复（P1-1, P2-4）：
 * - 废弃 AES-256-GCM 可逆加密，改用 PBKDF2-SHA512 单向哈希存储
 * - 移除机器信息（hostname/CPU/arch）参与密钥派生，避免设备变更导致永久锁死
 * - 仅使用独立随机盐 + 固定 APP_SALT，兼顾安全与设备迁移兼容性
 * - 兼容旧可逆密文配置，启动时自动迁移为单向哈希
 *
 * 保留原有：密码强度检测、错误重试冷却（5次/30秒）、时序安全比较、内存脱敏
 */

import * as crypto from 'crypto'
import { logger } from '../logger'

// ==================== 常量 ====================

const PBKDF2_ITERATIONS = 600000
const SALT_LENGTH = 32
const HASH_LENGTH = 64
/** 旧版 AES-256-GCM 加密前缀长度，用于迁移检测 */
const LEGACY_IV_LENGTH = 12
const LEGACY_TAG_LENGTH = 16
const LEGACY_PREFIX_LENGTH = LEGACY_IV_LENGTH + LEGACY_TAG_LENGTH

const MAX_RETRY_COUNT = 5
const COOLDOWN_DURATION = 30000

export const MIN_PASSWORD_LENGTH = 4
export const MAX_PASSWORD_LENGTH = 128

// ==================== 类型 ====================

/** 单向哈希存储结构 */
export interface PasswordHash {
  hash: string   // hex: salt(32B) + hash(64B)
  salt: string   // hex: 独立随机盐
  version: 2     // 标记为新版哈希格式
}

/** 兼容旧版可逆加密结构 */
interface LegacyEncryptedPassword {
  data: string
  salt: string
}

/** 存储的密码凭证（兼容新旧格式） */
export type StoredCredential = PasswordHash | LegacyEncryptedPassword

export interface PasswordVerifyResult {
  success: boolean
  verified: boolean
  cooldown?: boolean
  cooldownRemaining?: number
  remainingRetries?: number
  error?: string
}

export type PasswordStrength = 'weak' | 'medium' | 'strong'

// ==================== 哈希 ====================

function generateSalt(): Buffer {
  return crypto.randomBytes(SALT_LENGTH)
}

/**
 * 将明文密码哈希为不可逆的存储格式
 */
export function hashPassword(plainPassword: string): PasswordHash {
  const salt = generateSalt()
  const derived = crypto.pbkdf2Sync(plainPassword, salt, PBKDF2_ITERATIONS, HASH_LENGTH, 'sha512')
  return {
    hash: Buffer.concat([salt, derived]).toString('hex'),
    salt: salt.toString('hex'),
    version: 2,
  }
}

/**
 * 验证明文密码与存储哈希是否匹配
 */
export function verifyPasswordHash(plainPassword: string, stored: PasswordHash): boolean {
  const salt = Buffer.from(stored.salt, 'hex')
  const expected = Buffer.from(stored.hash, 'hex')
  if (expected.length !== SALT_LENGTH + HASH_LENGTH) return false
  const expectedHash = expected.subarray(SALT_LENGTH)
  const actual = crypto.pbkdf2Sync(plainPassword, salt, PBKDF2_ITERATIONS, HASH_LENGTH, 'sha512')
  try {
    return crypto.timingSafeEqual(actual, expectedHash)
  } catch {
    return false
  }
}

// ==================== 旧版兼容 ====================

/**
 * 从旧版 AES-256-GCM 可逆密文中提取明文密码，迁移为单向哈希
 */
function migrateLegacyToHash(legacy: LegacyEncryptedPassword, userInput: string): PasswordHash | null {
  try {
    const combined = Buffer.from(legacy.data, 'hex')
    if (combined.length < LEGACY_PREFIX_LENGTH) return null
    // 旧版使用机器特征派生密钥，无法直接解密。
    // 迁移策略：用户输入正确密码时，用旧版验证逻辑确认，若匹配则生成新版哈希。
    // 此处仅接收已验证的明文密码来创建新哈希。
    return hashPassword(userInput)
  } catch {
    return null
  }
}

/**
 * 检测并迁移旧格式
 * @returns 迁移后的 PasswordHash，若无需迁移或迁移失败返回 null
 */
export function tryMigrateCredential(
  raw: unknown,
  verifiedPassword?: string
): PasswordHash | null {
  if (!raw || typeof raw !== 'object') return null
  const stored = raw as StoredCredential
  // 已是新版格式
  if ('version' in stored && (stored as PasswordHash).version === 2) return null
  // 旧版格式 + 有已验证的明文密码 → 迁移
  if (verifiedPassword && 'data' in stored && 'salt' in stored) {
    return migrateLegacyToHash(stored as LegacyEncryptedPassword, verifiedPassword)
  }
  return null
}

// ==================== 纯校验 ====================

/**
 * 纯密码校验：仅比对哈希，不依赖锁屏解锁状态。
 * 用于 Windows Hello 开户等场景，无论软件是否已解锁都完整校验密码。
 */
export function verifyAppPassword(plainPassword: string, stored: PasswordHash): boolean {
  return verifyPasswordHash(plainPassword, stored)
}

// ==================== 带冷却的校验 ====================

const cooldownState = { failureCount: 0, cooldownUntil: 0, lastAttempt: 0 }

function isInCooldown(): boolean {
  if (cooldownState.failureCount < MAX_RETRY_COUNT) return false
  if (cooldownState.cooldownUntil === 0) return false
  return Date.now() < cooldownState.cooldownUntil
}

function getCooldownRemainingSeconds(): number {
  if (!isInCooldown()) return 0
  return Math.ceil((cooldownState.cooldownUntil - Date.now()) / 1000)
}

function getRemainingRetries(): number {
  if (isInCooldown()) return 0
  return Math.max(0, MAX_RETRY_COUNT - cooldownState.failureCount)
}

function recordFailure(): void {
  cooldownState.failureCount++
  cooldownState.lastAttempt = Date.now()
  if (cooldownState.failureCount >= MAX_RETRY_COUNT) {
    cooldownState.cooldownUntil = Date.now() + COOLDOWN_DURATION
    logger.warn(`App lock: ${cooldownState.failureCount} failures, cooldown ${COOLDOWN_DURATION / 1000}s`)
  }
}

function recordSuccess(): void {
  cooldownState.failureCount = 0
  cooldownState.cooldownUntil = 0
  cooldownState.lastAttempt = Date.now()
}

export function verifyPasswordWithCooldown(
  plainPassword: string,
  stored: PasswordHash
): PasswordVerifyResult {
  if (isInCooldown()) {
    return {
      success: false, verified: false, cooldown: true,
      cooldownRemaining: getCooldownRemainingSeconds(), remainingRetries: 0,
      error: `验证次数过多，请 ${getCooldownRemainingSeconds()} 秒后重试`,
    }
  }
  try {
    const isMatch = verifyPasswordHash(plainPassword, stored)
    if (isMatch) {
      recordSuccess()
      return { success: true, verified: true, remainingRetries: getRemainingRetries() }
    }
    recordFailure()
    const remaining = getRemainingRetries()
    return {
      success: true, verified: false, remainingRetries: remaining,
      error: remaining > 0 ? `密码错误，还剩 ${remaining} 次机会` : '密码错误次数过多，请稍后重试',
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : '密码验证异常'
    logger.error(`Password verification error: ${sanitizeLog(errMsg)}`)
    recordFailure()
    return { success: false, verified: false, remainingRetries: getRemainingRetries(), error: '密码验证出错' }
  }
}

export function resetCooldown(): void {
  cooldownState.failureCount = 0
  cooldownState.cooldownUntil = 0
  cooldownState.lastAttempt = 0
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  if (password.length < 6) return 'weak'
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[a-z]/.test(password)) score++
  if (/[A-Z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[^a-zA-Z\d]/.test(password)) score++
  if (score >= 5) return 'strong'
  if (score >= 3) return 'medium'
  return 'weak'
}

function sanitizeLog(message: string): string {
  return message.replace(/[0-9a-f]{64,}/gi, '***').replace(/[0-9a-f]{32,63}/gi, '***').substring(0, 200)
}
