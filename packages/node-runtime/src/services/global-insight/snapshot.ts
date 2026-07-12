import fs from 'node:fs'
import path from 'node:path'
import type { AnnualSummaryRange } from '@openchatlab/shared-types'
import { appLogger } from '../../logging/app-logger'
import { toAnnualSummaryRangeKey } from './time-range'
import type { AnnualSummarySnapshot } from './types'

const SNAPSHOT_TMP_PREFIX = 'annual-summary.tmp-'

export function getAnnualSummarySnapshotPath(snapshotDir: string, range: AnnualSummaryRange): string {
  return path.join(snapshotDir, `annual-summary-${toAnnualSummaryRangeKey(range)}.json`)
}

export function readAnnualSummarySnapshot(
  snapshotDir: string,
  range: AnnualSummaryRange,
  options: { now?: () => number } = {}
): AnnualSummarySnapshot | null {
  const snapshotPath = getAnnualSummarySnapshotPath(snapshotDir, range)
  if (!fs.existsSync(snapshotPath)) return null
  try {
    return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as AnnualSummarySnapshot
  } catch (error) {
    const backupPath = path.join(snapshotDir, `annual-summary.corrupt-${options.now?.() ?? Date.now()}.json`)
    try {
      fs.renameSync(snapshotPath, backupPath)
    } catch (renameError) {
      appLogger.warn('global-insight', 'failed to backup corrupt annual summary snapshot', renameError)
    }
    appLogger.warn('global-insight', 'annual summary snapshot is corrupt', error)
    return null
  }
}

export function writeAnnualSummarySnapshot(snapshotDir: string, snapshot: AnnualSummarySnapshot): void {
  fs.mkdirSync(snapshotDir, { recursive: true })
  const tmpPath = path.join(snapshotDir, `${SNAPSHOT_TMP_PREFIX}${process.pid}-${Date.now()}`)
  fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8')
  fs.renameSync(tmpPath, getAnnualSummarySnapshotPath(snapshotDir, snapshot.range))
}

export function cleanupAnnualSummarySnapshotTempFiles(snapshotDir: string): void {
  if (!fs.existsSync(snapshotDir)) return
  for (const name of fs.readdirSync(snapshotDir)) {
    if (!name.startsWith(SNAPSHOT_TMP_PREFIX)) continue
    try {
      fs.rmSync(path.join(snapshotDir, name), { force: true })
    } catch (error) {
      appLogger.warn('global-insight', 'failed to remove annual summary snapshot temp file', error)
    }
  }
}
