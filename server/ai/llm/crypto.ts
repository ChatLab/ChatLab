/**
 * API Key encryption utilities
 * Uses AES-256-GCM encryption with a key derived from a server-side secret.
 *
 * Key derivation sources (in order):
 *   1. CHATLAB_ENCRYPTION_KEY environment variable
 *   2. node-machine-id (same machine → same key)
 *   3. Fallback constant (least secure)
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

// Encryption algorithm
const ALGORITHM = 'aes-256-gcm'
// Prefix to identify encrypted data
const ENCRYPTED_PREFIX = 'enc:'
// Salt for key derivation (application-level unique)
const SALT = 'chatlab-api-key-encryption-v1'

/**
 * Derive encryption key from the best available source.
 * Same environment always produces the same key.
 */
function deriveKey(): Buffer {
  // 1. Explicit env var
  const envKey = process.env.CHATLAB_ENCRYPTION_KEY?.trim()
  if (envKey) {
    return createHash('sha256')
      .update(envKey + SALT)
      .digest()
  }

  // 2. Try node-machine-id (may not be installed)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { machineIdSync } = require('node-machine-id') as { machineIdSync: () => string }
    const machineId = machineIdSync()
    return createHash('sha256')
      .update(machineId + SALT)
      .digest()
  } catch {
    // node-machine-id not available — fall through
  }

  // 3. Fallback (less secure, but deterministic per install)
  return createHash('sha256')
    .update('chatlab-fallback-key' + SALT)
    .digest()
}

// Cache key to avoid recomputation
let cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (!cachedKey) {
    cachedKey = deriveKey()
  }
  return cachedKey
}

/** Reset cached key — useful for testing */
export function _resetKeyCache(): void {
  cachedKey = null
}

/**
 * Encrypt an API Key.
 * @returns Encrypted string in format: enc:iv:authTag:ciphertext
 */
export function encryptApiKey(plaintext: string): string {
  if (!plaintext) return ''

  const key = getKey()
  const iv = randomBytes(12) // GCM recommends 12-byte IV

  const cipher = createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  const authTag = cipher.getAuthTag()

  return `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`
}

/**
 * Decrypt an API Key.
 * @returns Decrypted plaintext, or empty string on failure.
 *          If value is not encrypted, returns it as-is (backward compat).
 */
export function decryptApiKey(encrypted: string): string {
  if (!encrypted) return ''

  // Not encrypted — return as-is (backward compat with plaintext data)
  if (!isEncrypted(encrypted)) {
    return encrypted
  }

  try {
    const key = getKey()

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
 * Check whether a string is in encrypted format.
 */
export function isEncrypted(value: string): boolean {
  return value?.startsWith(ENCRYPTED_PREFIX) ?? false
}
