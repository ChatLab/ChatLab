import path from 'node:path'

export function getGlobalInsightDir(userDataDir: string): string {
  return path.join(userDataDir, 'insight', 'annual-summary')
}

export function getGlobalInsightFactsCacheDir(userDataDir: string): string {
  return path.join(getGlobalInsightDir(userDataDir), 'facts')
}

export function getTimeInvestmentDir(userDataDir: string): string {
  return path.join(userDataDir, 'insight', 'time-investment')
}

export function getTimeInvestmentFactsCacheDir(userDataDir: string): string {
  return path.join(getTimeInvestmentDir(userDataDir), 'facts')
}
