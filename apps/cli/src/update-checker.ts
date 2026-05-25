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
const CACHE_STALE_MS = 6 * 60 * 60 * 1000 // 6h — startup cache TTL
const PERIODIC_CHECK_MS = 24 * 60 * 60 * 1000 // 24h — long-running service interval
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
      resolve(2)
      return
    }

    process.stdin.setRawMode(true)
    process.stdin.resume()

    const onData = (data: Buffer) => {
      const key = data.toString()
      if (key === '\x03') {
        process.stdin.setRawMode!(false)
        process.stdin.pause()
        process.exit(0)
      }
      // Only accept single-digit keys matching a valid choice;
      // ignore arrow keys (\x1b[A/B/C/D), Enter, and other non-digit input.
      if (key.length === 1) {
        const num = parseInt(key)
        if (num >= 1 && num <= choices.length) {
          process.stdin.removeListener('data', onData)
          process.stdin.setRawMode!(false)
          process.stdin.pause()
          process.stderr.write('\n')
          resolve(num)
        }
      }
    }
    process.stdin.on('data', onData)
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
 * Fire-and-forget: fetch latest version from npm and update local cache.
 * Runs in background so CLI startup is never blocked by network IO.
 */
function refreshCacheInBackground(existingCache: UpdateCache | null): void {
  fetchLatestVersion()
    .then((latestVersion) => {
      writeCache({
        lastCheckTime: Date.now(),
        latestVersion,
        skippedVersion: existingCache?.skippedVersion,
      })
    })
    .catch(() => {})
}

/**
 * Start a periodic background cache refresh for long-running services.
 * Immediately refreshes once on startup, then every 24h thereafter.
 * The update prompt will appear on the *next* CLI startup.
 * The timer is unref'd so it won't prevent process exit.
 */
export function startPeriodicUpdateCheck(): void {
  if (isDevEnvironment()) return
  refreshCacheInBackground(readCache())
  const timer = setInterval(() => {
    refreshCacheInBackground(readCache())
  }, PERIODIC_CHECK_MS)
  timer.unref()
}

/**
 * Check for updates and prompt user interactively.
 *
 * Strategy (Codex-style):
 *  - Read local cache synchronously (instant, no network).
 *  - If cache is stale, kick off a background fetch for *next* run.
 *  - Prompt is only shown when cache already contains a newer version.
 *  - This means the first run after a new release sees no prompt;
 *    the second run (with fresh cache) shows it — zero startup delay.
 */
export async function checkForUpdatesInteractive(): Promise<void> {
  if (!process.stdin.isTTY || process.env.CI || isDevEnvironment()) return

  const currentVersion = getVersion()
  const cache = readCache()

  // Kick off background refresh if cache is missing or stale
  if (!cache || Date.now() - cache.lastCheckTime >= CACHE_STALE_MS) {
    refreshCacheInBackground(cache)
  }

  // Prompt is based on cached data only — no network wait
  const latestVersion = cache?.latestVersion
  if (!latestVersion || !isNewerVersion(latestVersion, currentVersion)) return
  if (cache?.skippedVersion === latestVersion) return

  const choice = await promptUser(`  ✨ Update available! ${currentVersion} → ${latestVersion}`, [
    `Update now (runs \`npm install -g ${PACKAGE_NAME}\`)`,
    'Skip',
    'Skip until next version',
  ])

  if (choice === 1) {
    const result = await runNpmUpdate()
    if (result.success) {
      process.stderr.write(
        `  \x1b[32m🎉 Updated successfully! Please restart chatlab to use the new version.\x1b[0m\n\n`
      )
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
