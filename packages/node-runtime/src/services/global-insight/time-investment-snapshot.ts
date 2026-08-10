import fs from 'node:fs'
import path from 'node:path'
import type { AnnualSummaryRange } from '@openchatlab/shared-types'
import { appLogger } from '../../logging/app-logger'
import { toAnnualSummaryRangeKey } from './time-range'
import type { TimeInvestmentSnapshot } from './time-investment-types'

const SNAPSHOT_TMP_PREFIX = 'time-investment.tmp-'

export function getTimeInvestmentSnapshotPath(snapshotDir: string, range: AnnualSummaryRange): string {
  return path.join(snapshotDir, `time-investment-${toAnnualSummaryRangeKey(range)}.json`)
}

export function readTimeInvestmentSnapshot(
  snapshotDir: string,
  range: AnnualSummaryRange,
  options: { now?: () => number } = {}
): TimeInvestmentSnapshot | null {
  const snapshotPath = getTimeInvestmentSnapshotPath(snapshotDir, range)
  if (!fs.existsSync(snapshotPath)) return null
  try {
    return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as TimeInvestmentSnapshot
  } catch (error) {
    const backupPath = path.join(snapshotDir, `time-investment.corrupt-${options.now?.() ?? Date.now()}.json`)
    try {
      fs.renameSync(snapshotPath, backupPath)
    } catch (renameError) {
      appLogger.warn('global-insight', 'failed to backup corrupt time investment snapshot', renameError)
    }
    appLogger.warn('global-insight', 'time investment snapshot is corrupt', error)
    return null
  }
}

export function writeTimeInvestmentSnapshot(snapshotDir: string, snapshot: TimeInvestmentSnapshot): void {
  fs.mkdirSync(snapshotDir, { recursive: true })
  const tmpPath = path.join(snapshotDir, `${SNAPSHOT_TMP_PREFIX}${process.pid}-${Date.now()}`)
  fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8')
  fs.renameSync(tmpPath, getTimeInvestmentSnapshotPath(snapshotDir, snapshot.range))
}

export function cleanupTimeInvestmentSnapshotTempFiles(snapshotDir: string): void {
  if (!fs.existsSync(snapshotDir)) return
  for (const name of fs.readdirSync(snapshotDir)) {
    if (!name.startsWith(SNAPSHOT_TMP_PREFIX)) continue
    try {
      fs.rmSync(path.join(snapshotDir, name), { force: true })
    } catch (error) {
      appLogger.warn('global-insight', 'failed to remove time investment snapshot temp file', error)
    }
  }
}

export function deleteTimeInvestmentSnapshots(snapshotDir: string): void {
  if (!fs.existsSync(snapshotDir)) return
  for (const name of fs.readdirSync(snapshotDir)) {
    if (!name.startsWith('time-investment-') && !name.startsWith('time-investment.')) continue
    try {
      fs.rmSync(path.join(snapshotDir, name), { force: true })
    } catch (error) {
      appLogger.warn('global-insight', 'failed to remove time investment snapshot', error)
    }
  }
}
