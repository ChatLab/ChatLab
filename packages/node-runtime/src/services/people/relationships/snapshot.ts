import fs from 'node:fs'
import path from 'node:path'
import type { ContactsTimeRangePreset } from '@openchatlab/shared-types'
import { appLogger } from '../../../logging/app-logger'
import type { PeopleRelationshipsSnapshot } from './compute'
import { normalizePeopleRelationshipsTimeRangePreset } from './time-range'

const PEOPLE_RELATIONSHIPS_SNAPSHOT_TMP_PREFIX = 'people-relationships-snapshot.tmp-'

export interface ReadPeopleRelationshipsSnapshotOptions {
  now?: () => number
}

export function getPeopleRelationshipsSnapshotPath(
  snapshotDir: string,
  timeRangePreset?: ContactsTimeRangePreset
): string {
  const preset = normalizePeopleRelationshipsTimeRangePreset(timeRangePreset)
  return path.join(snapshotDir, `graph-snapshot-${preset}.json`)
}

export function readPeopleRelationshipsSnapshot(
  snapshotDir: string,
  timeRangePreset?: ContactsTimeRangePreset,
  options: ReadPeopleRelationshipsSnapshotOptions = {}
): PeopleRelationshipsSnapshot | null {
  const snapshotPath = getPeopleRelationshipsSnapshotPath(snapshotDir, timeRangePreset)
  if (!fs.existsSync(snapshotPath)) return null

  try {
    return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as PeopleRelationshipsSnapshot
  } catch (error) {
    const ts = options.now?.() ?? Date.now()
    const backupPath = path.join(snapshotDir, `graph-snapshot.corrupt-${ts}.json`)
    try {
      fs.renameSync(snapshotPath, backupPath)
    } catch (renameError) {
      appLogger.warn('people-relationships', 'failed to backup corrupt people relationships snapshot', renameError)
    }
    appLogger.warn('people-relationships', 'people relationships snapshot is corrupt', error)
    return null
  }
}

export function writePeopleRelationshipsSnapshot(snapshotDir: string, snapshot: PeopleRelationshipsSnapshot): void {
  if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true })
  const tmpPath = path.join(snapshotDir, `${PEOPLE_RELATIONSHIPS_SNAPSHOT_TMP_PREFIX}${process.pid}-${Date.now()}`)
  fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8')
  fs.renameSync(tmpPath, getPeopleRelationshipsSnapshotPath(snapshotDir, snapshot.timeRange.preset))
}

export function cleanupPeopleRelationshipsSnapshotTempFiles(snapshotDir: string): void {
  if (!fs.existsSync(snapshotDir)) return
  for (const name of fs.readdirSync(snapshotDir)) {
    if (!name.startsWith(PEOPLE_RELATIONSHIPS_SNAPSHOT_TMP_PREFIX)) continue
    try {
      fs.rmSync(path.join(snapshotDir, name), { force: true })
    } catch (error) {
      appLogger.warn('people-relationships', 'failed to remove people relationships snapshot temp file', error)
    }
  }
}
