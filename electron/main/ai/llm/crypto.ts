/**
 * API Key 加密工具
 * 使用 AES-256-GCM 加密，密钥从机器 ID 派生
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { machineIdSync } from 'node-machine-id'

// 加密算法
const ALGORITHM = 'aes-256-gcm'
// 加密前缀，用于标识已加密的数据
const ENCRYPTED_PREFIX = 'enc:'
// 盐值，用于密钥派生（应用级别唯一）
const SALT = 'chatlab-api-key-encryption-v1'

/**
 * 从机器 ID 派生加密密钥
 * 同一台机器总是生成相同的密钥
 */
function deriveKey(): Buffer {
  try {
    const machineId = machineIdSync()
    return createHash('sha256')
      .update(machineId + SALT)
      .digest()
  } catch (error) {
    // 如果无法获取机器 ID，使用固定的回退值（安全性降低）
    console.warn('Failed to get machine ID, using fallback key:', error)
    return createHash('sha256')
      .update('chatlab-fallback-key' + SALT)
      .digest()
  }
}

// 缓存密钥，避免每次都重新计算
let cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (!cachedKey) {
    cachedKey = deriveKey()
  }
  return cachedKey
}

/**
 * 加密 API Key
 * @param plaintext 明文 API Key
 * @returns 加密后的字符串，格式: enc:iv:authTag:ciphertext
 */
export function encryptApiKey(plaintext: string): string {
  if (!plaintext) return ''

  const key = getKey()
  const iv = randomBytes(12) // GCM 推荐 12 字节 IV

  const cipher = createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  const authTag = cipher.getAuthTag()

  // 格式: enc:iv:authTag:ciphertext
  return `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`
}

/**
 * 解密 API Key
 * @param encrypted 加密后的字符串
 * @returns 解密后的明文，如果解密失败返回空字符串
 */
export function decryptApiKey(encrypted: string): string {
  if (!encrypted) return ''

  // 如果不是加密格式，直接返回（兼容旧的明文数据）
  if (!isEncrypted(encrypted)) {
    return encrypted
  }

  try {
    const key = getKey()

    // 解析格式: enc:iv:authTag:ciphertext
    const parts = encrypted.slice(ENCRYPTED_PREFIX.length).split(':')
    if (parts.length !== 3) {
      console.warn('Encrypted data format error')
      return ''
    }

    const [ivBase64, authTagBase64, ciphertext] = parts
    const iv = Buffer.from(ivBase64, 'base64')
    const authTag = Buffer.from(authTagBase64, 'base64')

    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(ciphertext, 'base64', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } catch (error) {
    console.error('Failed to decrypt API Key:', error)
    return ''
  }
}

/**
 * 检查字符串是否是加密格式
 */
export function isEncrypted(value: string): boolean {
  return value?.startsWith(ENCRYPTED_PREFIX) ?? false
}
