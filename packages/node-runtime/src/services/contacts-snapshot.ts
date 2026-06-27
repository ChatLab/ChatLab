import fs from 'node:fs'
import path from 'node:path'
import { appLogger } from '../logging/app-logger'
import type { ContactsSnapshot } from './contacts-compute'

const CONTACTS_SNAPSHOT_FILE = 'contacts-snapshot.json'
const CONTACTS_SNAPSHOT_TMP_PREFIX = 'contacts-snapshot.tmp-'

export interface ReadContactsSnapshotOptions {
  now?: () => number
}

export function getContactsSnapshotPath(systemDir: string): string {
  return path.join(systemDir, CONTACTS_SNAPSHOT_FILE)
}

export function readContactsSnapshot(
  systemDir: string,
  options: ReadContactsSnapshotOptions = {}
): ContactsSnapshot | null {
  const snapshotPath = getContactsSnapshotPath(systemDir)
  if (!fs.existsSync(snapshotPath)) return null

  try {
    return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as ContactsSnapshot
  } catch (error) {
    const ts = options.now?.() ?? Date.now()
    const backupPath = path.join(systemDir, `contacts-snapshot.corrupt-${ts}.json`)
    try {
      fs.renameSync(snapshotPath, backupPath)
    } catch (renameError) {
      appLogger.warn('contacts', 'failed to backup corrupt contacts snapshot', renameError)
    }
    appLogger.warn('contacts', 'contacts snapshot is corrupt', error)
    return null
  }
}

export function writeContactsSnapshot(systemDir: string, snapshot: ContactsSnapshot): void {
  if (!fs.existsSync(systemDir)) fs.mkdirSync(systemDir, { recursive: true })
  const tmpPath = path.join(systemDir, `${CONTACTS_SNAPSHOT_TMP_PREFIX}${process.pid}-${Date.now()}`)
  fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8')
  fs.renameSync(tmpPath, getContactsSnapshotPath(systemDir))
}

export function cleanupContactsSnapshotTempFiles(systemDir: string): void {
  if (!fs.existsSync(systemDir)) return
  for (const name of fs.readdirSync(systemDir)) {
    if (!name.startsWith(CONTACTS_SNAPSHOT_TMP_PREFIX)) continue
    try {
      fs.rmSync(path.join(systemDir, name), { force: true })
    } catch (error) {
      appLogger.warn('contacts', 'failed to remove contacts snapshot temp file', error)
    }
  }
}
