/**
 * API Key 加密工具
 * 使用 AES-256-GCM 加密，密钥从持久化的设备密钥派生
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { execSync } from 'child_process'
import { getDeviceKey } from './device-key'

// 加密算法
const ALGORITHM = 'aes-256-gcm'
// 加密前缀，用于标识已加密的数据
const ENCRYPTED_PREFIX = 'enc:'
// 盐值，用于密钥派生（应用级别唯一）
const SALT = 'chatlab-api-key-encryption-v1'

/**
 * 从设备密钥派生加密密钥
 */
function deriveKey(): Buffer {
  const deviceKey = getDeviceKey()
  return createHash('sha256')
    .update(deviceKey + SALT)
    .digest()
}

/**
 * 从旧的 machine-id 方案派生密钥（用于迁移）
 * 尝试读取系统 machine-id，如果失败则尝试 fallback key
 */
function deriveLegacyKeys(): Buffer[] {
  const keys: Buffer[] = []
  try {
    const platform = process.platform
    let cmd: string | null = null
    if (platform === 'linux') {
      cmd = '( cat /var/lib/dbus/machine-id /etc/machine-id 2> /dev/null || hostname ) | head -n 1 || :'
    } else if (platform === 'darwin') {
      cmd = 'ioreg -rd1 -c IOPlatformExpertDevice'
    } else if (platform === 'win32') {
      cmd = 'REG.exe QUERY HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid'
    }

    if (cmd) {
      const raw = execSync(cmd).toString()
      let machineId: string
      if (platform === 'darwin') {
        machineId =
          raw
            .split('IOPlatformUUID')[1]
            ?.split('\n')[0]
            ?.replace(/[=\s"]/g, '')
            ?.toLowerCase() || ''
      } else if (platform === 'win32') {
        machineId =
          raw
            .split('REG_SZ')[1]
            ?.replace(/[\r\n\s]/g, '')
            ?.toLowerCase() || ''
      } else {
        machineId = raw.replace(/[\r\n\s]/g, '').toLowerCase()
      }

      if (machineId) {
        // node-machine-id 默认会对 machine-id 做一次 sha256 hash
        const hashed = createHash('sha256').update(machineId).digest('hex')
        keys.push(
          createHash('sha256')
            .update(hashed + SALT)
            .digest()
        )
      }
    }
  } catch {
    // 系统命令失败，忽略
  }

  // 旧版 fallback key
  keys.push(
    createHash('sha256')
      .update('chatlab-fallback-key' + SALT)
      .digest()
  )
  return keys
}

// 缓存密钥
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
 * 用指定密钥尝试解密
 */
function tryDecryptWithKey(encrypted: string, key: Buffer): string | null {
  try {
    const parts = encrypted.slice(ENCRYPTED_PREFIX.length).split(':')
    if (parts.length !== 3) return null

    const [ivBase64, authTagBase64, ciphertext] = parts
    const iv = Buffer.from(ivBase64, 'base64')
    const authTag = Buffer.from(authTagBase64, 'base64')

    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(ciphertext, 'base64', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } catch {
    return null
  }
}

/**
 * 解密 API Key
 * 优先使用当前密钥，失败时尝试旧版 machine-id 密钥（自动迁移）
 * @param encrypted 加密后的字符串
 * @returns 解密后的明文，如果解密失败返回空字符串
 */
export function decryptApiKey(encrypted: string): string {
  if (!encrypted) return ''

  // 如果不是加密格式，直接返回（兼容旧的明文数据）
  if (!isEncrypted(encrypted)) {
    return encrypted
  }

  // 尝试当前密钥
  const currentKey = getKey()
  const result = tryDecryptWithKey(encrypted, currentKey)
  if (result !== null) return result

  // 当前密钥失败，尝试旧版 machine-id 密钥（迁移场景）
  const legacyKeys = deriveLegacyKeys()
  for (const legacyKey of legacyKeys) {
    const legacyResult = tryDecryptWithKey(encrypted, legacyKey)
    if (legacyResult !== null) {
      console.log('[Crypto] Decrypted with legacy key, migration needed')
      return legacyResult
    }
  }

  console.error('[Crypto] Failed to decrypt API Key with all available keys')
  return ''
}

/**
 * 检查字符串是否是加密格式
 */
export function isEncrypted(value: string): boolean {
  return value?.startsWith(ENCRYPTED_PREFIX) ?? false
}
