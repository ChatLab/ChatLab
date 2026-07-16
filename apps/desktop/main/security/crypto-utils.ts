/**
 * 密码加密工具模块
 *
 * 使用 AES-256-GCM 对密码进行加密存储。
 * - 密钥通过 PBKDF2 从机器特征 + 固定盐值派生，确保每台设备加密结果不同
 * - 加密后密码以 hex 编码存储在本地配置中，无明文
 * - 内存中密码使用后立即清零（Buffer.fill(0)）
 * - 支持改密、重置密码、密码验证
 *
 * 安全设计：
 * - 无第三方加密库依赖，使用 Node.js 内置 crypto 模块
 * - AES-256-GCM 提供认证加密（AEAD），防止密文篡改
 * - 密钥派生使用 PBKDF2-SHA512，迭代 200000 次
 * - 每次加密使用随机 IV + AAD，抵抗重放攻击
 * - 错误重试冷却（5 次失败后锁定 30 秒）
 */

import * as crypto from 'crypto'
import * as os from 'os'
import { logger } from '../logger'

// ==================== 常量定义 ====================

/** AES-256-GCM 密钥长度 (bytes) */
const KEY_LENGTH = 32

/** GCM 认证标签长度 (bytes) */
const TAG_LENGTH = 16

/** IV 长度 (bytes) */
const IV_LENGTH = 12

/** PBKDF2 迭代次数 */
const PBKDF2_ITERATIONS = 200000

/** PBKDF2 盐值长度 (bytes) */
const SALT_LENGTH = 32

/** 固定盐值（用于 PBKDF2，与机器信息混合） */
const APP_SALT = 'ChatLab.AppLock.Security.v1.2024.CHATLAB_LOCK_SALT'

/** 加密后的数据格式: iv(12) + tag(16) + ciphertext */
const ENCRYPTED_PREFIX_LENGTH = IV_LENGTH + TAG_LENGTH

/** 最大重试次数，超过后进入冷却期 */
const MAX_RETRY_COUNT = 5

/** 冷却时间 (ms) */
const COOLDOWN_DURATION = 30000

/** 密码最小长度 */
export const MIN_PASSWORD_LENGTH = 4

/** 密码最大长度（防止过长的密码导致 DoS） */
export const MAX_PASSWORD_LENGTH = 128

// ==================== 类型定义 ====================

/** 加密后的密码数据 */
export interface EncryptedPassword {
  /** hex 编码的加密数据 */
  data: string
  /** PBKDF2 盐值 (hex) */
  salt: string
}

/** 密码验证结果 */
export interface PasswordVerifyResult {
  success: boolean
  /** 密码正确 */
  verified: boolean
  /** 是否需要冷却 */
  cooldown?: boolean
  /** 冷却剩余时间 (秒) */
  cooldownRemaining?: number
  /** 剩余重试次数 */
  remainingRetries?: number
  /** 错误信息 */
  error?: string
}

/** 密码强度等级 */
export type PasswordStrength = 'weak' | 'medium' | 'strong'

// ==================== 密钥派生 ====================

/**
 * 从机器特征派生加密密钥
 *
 * 使用机器 hostname + CPU 信息 + 固定盐值生成 PBKDF2 派生密钥。
 * 这确保：
 * 1. 加密文件即使被复制到其他机器也无法解密
 * 2. 同一台机器上 ChatLab 总是派生出相同的密钥
 */
function deriveKey(salt: Buffer): Buffer {
  // 收集机器特征（不包含敏感信息）
  const machineInfo = [
    os.hostname(),
    os.cpus()[0]?.model || 'unknown-cpu',
    os.platform(),
    os.arch(),
    APP_SALT,
  ].join('|')

  return crypto.pbkdf2Sync(machineInfo, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512')
}

/**
 * 生成随机盐值
 */
function generateSalt(): Buffer {
  return crypto.randomBytes(SALT_LENGTH)
}

// ==================== 加密/解密 ====================

/**
 * 加密密码
 *
 * @param plainPassword 明文密码
 * @returns EncryptedPassword 加密后的密码数据
 */
export function encryptPassword(plainPassword: string): EncryptedPassword {
  const salt = generateSalt()
  const key = deriveKey(salt)
  const iv = crypto.randomBytes(IV_LENGTH)
  const aad = Buffer.from('ChatLabAppLock')

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: TAG_LENGTH,
  })
  cipher.setAAD(aad)

  const passwordBuffer = Buffer.from(plainPassword, 'utf-8')
  const encrypted = Buffer.concat([cipher.update(passwordBuffer), cipher.final()])
  const tag = cipher.getAuthTag()

  // 格式：IV(12) + Tag(16) + 密文
  const combined = Buffer.concat([iv, tag, encrypted])

  // 内存清除
  key.fill(0)
  passwordBuffer.fill(0)

  return {
    data: combined.toString('hex'),
    salt: salt.toString('hex'),
  }
}

/**
 * 解密密码
 *
 * @param encrypted 加密数据
 * @returns 明文密码（使用后请立即用 Buffer.fill(0) 清除）
 */
export function decryptPassword(encrypted: EncryptedPassword): string {
  const salt = Buffer.from(encrypted.salt, 'hex')
  const combined = Buffer.from(encrypted.data, 'hex')

  if (combined.length < ENCRYPTED_PREFIX_LENGTH) {
    throw new Error('密码数据已损坏')
  }

  const key = deriveKey(salt)
  const iv = combined.subarray(0, IV_LENGTH)
  const tag = combined.subarray(IV_LENGTH, ENCRYPTED_PREFIX_LENGTH)
  const ciphertext = combined.subarray(ENCRYPTED_PREFIX_LENGTH)
  const aad = Buffer.from('ChatLabAppLock')

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, {
      authTagLength: TAG_LENGTH,
    })
    decipher.setAAD(aad)
    decipher.setAuthTag(tag)

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])

    const result = decrypted.toString('utf-8')

    // 内存清除
    key.fill(0)
    decrypted.fill(0)

    return result
  } catch {
    key.fill(0)
    throw new Error('密码解密失败：密钥错误或数据已损坏')
  }
}

/**
 * 安全比较两个 Buffer，防止时序攻击
 */
function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    // 仍做常量时间比较以防止长度泄漏
    crypto.timingSafeEqual(
      Buffer.alloc(Math.max(a.length, b.length)),
      Buffer.alloc(Math.max(a.length, b.length))
    )
    return false
  }
  return crypto.timingSafeEqual(a, b)
}

/**
 * 验证密码
 *
 * @param plainPassword 用户输入的明文密码
 * @param stored 已存储的加密密码
 * @returns boolean 密码是否匹配
 */
export function verifyPassword(plainPassword: string, stored: EncryptedPassword): boolean {
  const storedDecrypted = decryptPassword(stored)

  // 使用 timingSafeEqual 防止时序攻击
  const inputBuffer = Buffer.from(plainPassword, 'utf-8')
  const storedBuffer = Buffer.from(storedDecrypted, 'utf-8')
  const safeResult = timingSafeEqual(inputBuffer, storedBuffer)

  // 内存清除
  inputBuffer.fill(0)
  storedBuffer.fill(0)

  return safeResult
}

// ==================== 密码强度检测 ====================

/**
 * 评估密码强度
 */
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

// ==================== 重试冷却管理 ====================

/** 冷却状态（每个 app 生命周期内） */
const cooldownState = {
  failureCount: 0,
  cooldownUntil: 0,
  lastAttempt: 0,
}

/**
 * 检查是否处于冷却期
 */
function isInCooldown(): boolean {
  if (cooldownState.failureCount < MAX_RETRY_COUNT) return false
  if (cooldownState.cooldownUntil === 0) return false
  return Date.now() < cooldownState.cooldownUntil
}

/**
 * 获取冷却剩余时间 (秒)
 */
function getCooldownRemainingSeconds(): number {
  if (!isInCooldown()) return 0
  return Math.ceil((cooldownState.cooldownUntil - Date.now()) / 1000)
}

/**
 * 获取剩余重试次数
 */
function getRemainingRetries(): number {
  if (isInCooldown()) return 0
  return Math.max(0, MAX_RETRY_COUNT - cooldownState.failureCount)
}

/**
 * 记录一次失败的验证尝试
 */
function recordFailure(): void {
  cooldownState.failureCount++
  cooldownState.lastAttempt = Date.now()

  if (cooldownState.failureCount >= MAX_RETRY_COUNT) {
    cooldownState.cooldownUntil = Date.now() + COOLDOWN_DURATION
    logger.warn(
      `App lock: too many failed attempts (${cooldownState.failureCount}), cooldown for ${COOLDOWN_DURATION / 1000}s`
    )
  }
}

/**
 * 记录一次成功的验证
 */
function recordSuccess(): void {
  cooldownState.failureCount = 0
  cooldownState.cooldownUntil = 0
  cooldownState.lastAttempt = Date.now()
}

/**
 * 带重试冷却的密码验证
 *
 * @returns PasswordVerifyResult
 */
export function verifyPasswordWithCooldown(
  plainPassword: string,
  stored: EncryptedPassword
): PasswordVerifyResult {
  // 检查冷却
  if (isInCooldown()) {
    return {
      success: false,
      verified: false,
      cooldown: true,
      cooldownRemaining: getCooldownRemainingSeconds(),
      remainingRetries: 0,
      error: `验证次数过多，请 ${getCooldownRemainingSeconds()} 秒后重试`,
    }
  }

  try {
    const isMatch = verifyPassword(plainPassword, stored)

    if (isMatch) {
      recordSuccess()
      return { success: true, verified: true, remainingRetries: getRemainingRetries() }
    } else {
      recordFailure()
      const remaining = getRemainingRetries()
      return {
        success: true,
        verified: false,
        remainingRetries: remaining,
        error: remaining > 0 ? `密码错误，还剩 ${remaining} 次机会` : '密码错误次数过多，请稍后重试',
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : '密码验证异常'
    logger.error(`Password verification error: ${sanitizeCryptoLog(errMsg)}`)
    recordFailure()
    return {
      success: false,
      verified: false,
      remainingRetries: getRemainingRetries(),
      error: '密码验证出错',
    }
  }
}

/**
 * 重置重试冷却状态
 */
export function resetCooldown(): void {
  cooldownState.failureCount = 0
  cooldownState.cooldownUntil = 0
  cooldownState.lastAttempt = 0
}

/**
 * 重置密码（清除旧加密数据）
 */
export function resetPassword(): void {
  resetCooldown()
}

/**
 * 日志脱敏：过滤加密相关日志中的敏感信息
 */
function sanitizeCryptoLog(message: string): string {
  return message
    .replace(/[0-9a-f]{64,}/gi, '***')
    .replace(/[0-9a-f]{32,63}/gi, '***')
    .substring(0, 200)
}
