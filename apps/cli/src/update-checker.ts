/**
 * CLI startup update checker — npm registry version comparison
 * with interactive prompt (Codex-style).
 *
 * Caches check results to avoid hitting npm on every invocation.
 * Respects user "skip until next version" preference.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execFile } from 'child_process'
import { getVersion } from './version'

const PACKAGE_NAME = 'chatlab-cli'
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours
const CACHE_FILE = path.join(os.homedir(), '.chatlab', 'update-check.json')

interface UpdateCache {
  lastCheckTime: number
  latestVersion: string | null
  skippedVersion?: string
}

function readCache(): UpdateCache | null {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
    }
  } catch {
    // corrupted cache
  }
  return null
}

function writeCache(cache: UpdateCache): void {
  try {
    const dir = path.dirname(CACHE_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf-8')
  } catch {
    // non-critical
  }
}

function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => {
    const [core, pre] = v.split('-', 2)
    const parts = core.split('.').map(Number)
    return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0, pre }
  }
  const l = parse(latest)
  const c = parse(current)
  if (l.major !== c.major) return l.major > c.major
  if (l.minor !== c.minor) return l.minor > c.minor
  if (l.patch !== c.patch) return l.patch > c.patch
  if (c.pre && !l.pre) return true
  return false
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const resp = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!resp.ok) return null
    const data = (await resp.json()) as { version?: string }
    return data.version || null
  } catch {
    return null
  }
}

function promptUser(question: string, choices: string[]): Promise<number> {
  return new Promise((resolve) => {
    process.stderr.write(`${question}\n\n`)
    choices.forEach((c, i) => {
      process.stderr.write(i === 0 ? `› ${i + 1}. ${c}\n` : `  ${i + 1}. ${c}\n`)
    })
    process.stderr.write('\n')

    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
      resolve(2) // default to "Skip" in non-interactive
      return
    }

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.once('data', (data) => {
      process.stdin.setRawMode!(false)
      process.stdin.pause()
      const key = data.toString()
      if (key === '\x03') process.exit(0) // Ctrl+C
      const num = parseInt(key)
      process.stderr.write('\n')
      resolve(num >= 1 && num <= choices.length ? num : 2)
    })
  })
}

function runNpmUpdate(): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    process.stderr.write(`\n  Running: npm install -g ${PACKAGE_NAME}@latest\n\n`)

    const child = execFile(
      npmCmd,
      ['install', '-g', `${PACKAGE_NAME}@latest`],
      { timeout: 120_000 },
      (err, _stdout, stderr) => {
        if (err) {
          resolve({ success: false, error: stderr || err.message })
        } else {
          resolve({ success: true })
        }
      }
    )
    child.stdout?.pipe(process.stderr)
    child.stderr?.pipe(process.stderr)
  })
}

function isDevEnvironment(): boolean {
  if (process.env.CHATLAB_SKIP_UPDATE_CHECK) return true
  if (process.env.NODE_ENV === 'development') return true
  const entryFile = process.argv[1] || ''
  return entryFile.endsWith('.ts') || entryFile.endsWith('.mts')
}

/**
 * Check for updates and prompt user interactively.
 * Returns quickly if no update, check was recent, or running in dev.
 */
export async function checkForUpdatesInteractive(): Promise<void> {
  if (!process.stdin.isTTY || process.env.CI || isDevEnvironment()) return

  const currentVersion = getVersion()
  const cache = readCache()

  let latestVersion: string | null = null

  // Use cached result if recent enough
  if (cache && Date.now() - cache.lastCheckTime < CHECK_INTERVAL_MS) {
    latestVersion = cache.latestVersion
  } else {
    latestVersion = await fetchLatestVersion()
    writeCache({
      lastCheckTime: Date.now(),
      latestVersion,
      skippedVersion: cache?.skippedVersion,
    })
  }

  if (!latestVersion || !isNewerVersion(latestVersion, currentVersion)) return

  // User previously chose "skip until next version" for this exact version
  if (cache?.skippedVersion === latestVersion) return

  const choice = await promptUser(`  ✨ Update available! ${currentVersion} → ${latestVersion}`, [
    `Update now (runs \`npm install -g ${PACKAGE_NAME}\`)`,
    'Skip',
    'Skip until next version',
  ])

  if (choice === 1) {
    const result = await runNpmUpdate()
    if (result.success) {
      process.stderr.write(`  🎉 Updated successfully! Please restart chatlab.\n\n`)
      process.exit(0)
    } else {
      process.stderr.write(`  ❌ Update failed: ${result.error}\n\n`)
    }
  } else if (choice === 3) {
    writeCache({
      lastCheckTime: Date.now(),
      latestVersion,
      skippedVersion: latestVersion,
    })
  }
}
