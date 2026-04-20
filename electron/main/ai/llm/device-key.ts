/**
 * 设备密钥管理
 * 在应用数据目录下持久化一个随机生成的设备密钥，用于 API Key 加密。
 * 替代 node-machine-id，解决 Linux ARM64 等环境下 machine-id 不可用或不稳定的问题。
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomBytes } from 'crypto'
import { getAppDataDir, ensureDir } from '../../paths'

const DEVICE_KEY_FILE = '.device-key'

let cachedDeviceKey: string | null = null

/**
 * 获取设备密钥（32 字节随机值的 hex 字符串）
 * 首次调用时从文件读取，文件不存在则生成并写入。
 */
export function getDeviceKey(): string {
  if (cachedDeviceKey) return cachedDeviceKey

  const dataDir = getAppDataDir()
  ensureDir(dataDir)
  const keyPath = path.join(dataDir, DEVICE_KEY_FILE)

  try {
    if (fs.existsSync(keyPath)) {
      const key = fs.readFileSync(keyPath, 'utf-8').trim()
      if (key.length >= 32) {
        cachedDeviceKey = key
        return cachedDeviceKey
      }
    }
  } catch (error) {
    console.warn('[DeviceKey] Failed to read device key file:', error)
  }

  // 生成新密钥
  const newKey = randomBytes(32).toString('hex')
  try {
    fs.writeFileSync(keyPath, newKey, { encoding: 'utf-8', mode: 0o600 })
    console.log('[DeviceKey] Generated new device key')
  } catch (error) {
    console.error('[DeviceKey] Failed to write device key file:', error)
  }

  cachedDeviceKey = newKey
  return cachedDeviceKey
}

/**
 * 重置缓存（仅测试用）
 */
export function resetDeviceKeyCache(): void {
  cachedDeviceKey = null
}
