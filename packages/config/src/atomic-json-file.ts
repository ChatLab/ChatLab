import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const LOCK_RETRY_MS = 10
const LOCK_TIMEOUT_MS = 10_000
const LOCK_STALE_MS = 30_000
const waitBuffer = new Int32Array(new SharedArrayBuffer(4))

function waitForRetry(): void {
  Atomics.wait(waitBuffer, 0, 0, LOCK_RETRY_MS)
}

function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function getRemovableLockToken(lockPath: string): string | null {
  try {
    const owner = fs.readFileSync(lockPath, 'utf-8')
    const ownerPid = Number.parseInt(owner.split(':', 1)[0] || '', 10)
    const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs
    if (!Number.isInteger(ownerPid) || ownerPid <= 0) {
      return ageMs > LOCK_STALE_MS ? owner : null
    }
    if (!isProcessRunning(ownerPid)) return owner
    return null
  } catch {
    // A competing process may have created the lock before finishing its write.
    return null
  }
}

function tryRecoverStaleLock(lockPath: string, staleToken: string, deadline: number): boolean {
  const staleTokenHash = createHash('sha256').update(`${lockPath}\0${staleToken}`).digest('hex')
  const recoveryPath = path.join(path.dirname(lockPath), `.chatlab-lock-recovery-${staleTokenHash}`)
  const recoveryLock = acquireLockPath(recoveryPath, deadline)
  try {
    if (fs.readFileSync(lockPath, 'utf-8') !== staleToken) return false
    fs.rmSync(lockPath, { force: true })
    return true
  } catch {
    return false
  } finally {
    releaseFileLock(recoveryLock.lockPath, recoveryLock.token)
  }
}

function acquireLockPath(lockPath: string, deadline: number): { lockPath: string; token: string } {
  const token = `${process.pid}:${randomUUID()}`
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })

  while (true) {
    try {
      fs.writeFileSync(lockPath, token, { encoding: 'utf-8', flag: 'wx', mode: 0o600 })
      return { lockPath, token }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw error

      const removableToken = getRemovableLockToken(lockPath)
      if (removableToken !== null && tryRecoverStaleLock(lockPath, removableToken, deadline)) {
        continue
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for configuration file lock: ${lockPath}`)
      }
      waitForRetry()
    }
  }
}

function acquireFileLock(filePath: string): { lockPath: string; token: string } {
  return acquireLockPath(`${filePath}.lock`, Date.now() + LOCK_TIMEOUT_MS)
}

function releaseFileLock(lockPath: string, token: string): void {
  try {
    if (fs.readFileSync(lockPath, 'utf-8') === token) {
      fs.rmSync(lockPath, { force: true })
    }
  } catch {
    // The lock may already have been removed after becoming stale.
  }
}

export function withFileLock<T>(filePath: string, action: () => T): T {
  const lock = acquireFileLock(filePath)
  try {
    return action()
  } finally {
    releaseFileLock(lock.lockPath, lock.token)
  }
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

export function writeJsonFileAtomically<T>(filePath: string, data: T, mode?: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), {
      encoding: 'utf-8',
      ...(mode === undefined ? {} : { mode }),
    })
    fs.renameSync(tempPath, filePath)
  } finally {
    fs.rmSync(tempPath, { force: true })
  }
}
