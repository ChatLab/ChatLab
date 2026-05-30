/**
 * System service management — register ChatLab as a launchd (macOS) or
 * systemd --user (Linux) service for auto-start on login and crash recovery.
 *
 * macOS : ~/Library/LaunchAgents/fun.chatlab.daemon.plist
 * Linux : ~/.config/systemd/user/chatlab.service
 * Meta  : ~/.chatlab/daemon.json  { port, host, installedAt }
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import { resolveCliPath } from '../paths'

const SERVICE_LABEL = 'fun.chatlab.daemon'
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`)
const SYSTEMD_DIR = path.join(os.homedir(), '.config', 'systemd', 'user')
const SYSTEMD_SERVICE = path.join(SYSTEMD_DIR, 'chatlab.service')
const SYSTEM_DIR = path.join(os.homedir(), '.chatlab')
const LOG_FILE = path.join(SYSTEM_DIR, 'logs', 'daemon.log')
const META_FILE = path.join(SYSTEM_DIR, 'daemon.json')

interface DaemonMeta {
  port: number
  host: string
  installedAt: string
}

function writeMeta(meta: DaemonMeta): void {
  fs.mkdirSync(SYSTEM_DIR, { recursive: true })
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
}

function readMeta(): DaemonMeta | null {
  try {
    if (!fs.existsSync(META_FILE)) return null
    return JSON.parse(fs.readFileSync(META_FILE, 'utf-8')) as DaemonMeta
  } catch {
    return null
  }
}

function removeMeta(): void {
  try {
    fs.unlinkSync(META_FILE)
  } catch {
    // already removed, ignore
  }
}

// ── Public types ──────────────────────────────────────────────────────

export interface ServiceInstallOptions {
  port?: number
  host?: string
  token?: string
  headless?: boolean
}

export interface ServiceStatus {
  installed: boolean
  running: boolean
  port?: number
  host?: string
}

// ── macOS (launchd) ───────────────────────────────────────────────────

function buildPlist(options: ServiceInstallOptions): string {
  const port = options.port ?? 3110
  const host = options.host ?? '127.0.0.1'
  const cliEntry = resolveCliPath('dist/cli.mjs')
  const args = ['start', '--no-open', '--port', String(port), '--host', host]
  if (options.token) args.push('--token', options.token)
  if (options.headless) args.push('--headless')

  const programArgs = [process.execPath, cliEntry, ...args]
    .map((a) => `    <string>${a}</string>`)
    .join('\n')

  fs.mkdirSync(path.join(SYSTEM_DIR, 'logs'), { recursive: true })

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
</dict>
</plist>
`
}

function getUid(): string {
  return execSync('id -u', { encoding: 'utf-8' }).trim()
}

function launchctlLoad(plistPath: string): void {
  try {
    execSync(`launchctl bootstrap gui/${getUid()} "${plistPath}"`, { stdio: 'pipe' })
  } catch {
    try {
      execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' })
    } catch (err) {
      throw new Error(`launchctl load failed: ${err instanceof Error ? err.message : err}`)
    }
  }
}

function launchctlUnload(plistPath: string): void {
  try {
    execSync(`launchctl bootout gui/${getUid()}/${SERVICE_LABEL}`, { stdio: 'pipe' })
  } catch {
    try {
      execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' })
    } catch {
      // already unloaded, ignore
    }
  }
}

function installMacos(options: ServiceInstallOptions): void {
  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true })

  if (fs.existsSync(PLIST_PATH)) {
    launchctlUnload(PLIST_PATH)
  }

  fs.writeFileSync(PLIST_PATH, buildPlist(options))
  launchctlLoad(PLIST_PATH)

  const port = options.port ?? 3110
  const host = options.host ?? '127.0.0.1'
  writeMeta({ port, host, installedAt: new Date().toISOString() })

  console.log(`\nChatLab is now running as a system service`)
  console.log(`  API:     http://${host}:${port}`)
  console.log(`  Logs:    ${LOG_FILE}`)
  console.log(`  Service: ${SERVICE_LABEL} (launchd)`)
  console.log(`\nAuto-starts on login. Use \`chatlab stop\` to remove.\n`)
}

function uninstallMacos(): void {
  if (!fs.existsSync(PLIST_PATH)) {
    console.log('No system service found.')
    removeMeta()
    return
  }
  launchctlUnload(PLIST_PATH)
  fs.unlinkSync(PLIST_PATH)
  removeMeta()
  console.log(`ChatLab system service removed.`)
}

function statusMacos(): ServiceStatus {
  if (!fs.existsSync(PLIST_PATH)) return { installed: false, running: false }
  let running = false
  try {
    const out = execSync(`launchctl list | grep ${SERVICE_LABEL}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim()
    // launchctl list: PID  Status  Label — PID is '-' when not running
    running = out.length > 0 && !out.startsWith('-')
  } catch {
    running = false
  }
  const meta = readMeta()
  return { installed: true, running, port: meta?.port, host: meta?.host }
}

// ── Linux (systemd --user) ────────────────────────────────────────────

function escapeSystemdArg(arg: string): string {
  return '"' + arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

function buildUnit(options: ServiceInstallOptions): string {
  const port = options.port ?? 3110
  const host = options.host ?? '127.0.0.1'
  const cliEntry = resolveCliPath('dist/cli.mjs')
  const args = ['start', '--no-open', '--port', String(port), '--host', host]
  if (options.token) args.push('--token', options.token)
  if (options.headless) args.push('--headless')
  const execStart = [process.execPath, cliEntry, ...args].map(escapeSystemdArg).join(' ')

  return `[Unit]
Description=ChatLab daemon
After=network.target

[Service]
ExecStart=${execStart}
Restart=always
RestartSec=5
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}

[Install]
WantedBy=default.target
`
}

function installLinux(options: ServiceInstallOptions): void {
  fs.mkdirSync(SYSTEMD_DIR, { recursive: true })
  fs.mkdirSync(path.join(SYSTEM_DIR, 'logs'), { recursive: true })

  fs.writeFileSync(SYSTEMD_SERVICE, buildUnit(options))

  try {
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' })
    execSync('systemctl --user enable --now chatlab.service', { stdio: 'pipe' })
  } catch (err) {
    throw new Error(`systemctl failed: ${err instanceof Error ? err.message : err}`)
  }

  const port = options.port ?? 3110
  const host = options.host ?? '127.0.0.1'
  writeMeta({ port, host, installedAt: new Date().toISOString() })

  console.log(`\nChatLab is now running as a system service`)
  console.log(`  API:  http://${host}:${port}`)
  console.log(`  Logs: ${LOG_FILE}`)
  console.log(`  Unit: ${SYSTEMD_SERVICE} (systemd)`)
  console.log(`\nAuto-starts on login. Use \`chatlab stop\` to remove.\n`)
}

function uninstallLinux(): void {
  if (!fs.existsSync(SYSTEMD_SERVICE)) {
    console.log('No system service found.')
    removeMeta()
    return
  }
  try {
    execSync('systemctl --user disable --now chatlab.service', { stdio: 'pipe' })
  } catch {
    // already stopped
  }
  try {
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' })
  } catch {
    // ignore
  }
  fs.unlinkSync(SYSTEMD_SERVICE)
  removeMeta()
  console.log(`ChatLab system service removed.`)
}

function statusLinux(): ServiceStatus {
  if (!fs.existsSync(SYSTEMD_SERVICE)) return { installed: false, running: false }
  let running = false
  try {
    execSync('systemctl --user is-active --quiet chatlab.service', { stdio: 'pipe' })
    running = true
  } catch {
    running = false
  }
  const meta = readMeta()
  return { installed: true, running, port: meta?.port, host: meta?.host }
}

// ── Public API ────────────────────────────────────────────────────────

export function serviceInstall(options: ServiceInstallOptions): void {
  switch (process.platform) {
    case 'darwin':
      return installMacos(options)
    case 'linux':
      return installLinux(options)
    default:
      console.error('Windows is not yet supported for daemon mode.')
      console.error('Please use `chatlab start` to run in the foreground instead.')
      process.exit(1)
  }
}

export function serviceUninstall(): void {
  switch (process.platform) {
    case 'darwin':
      return uninstallMacos()
    case 'linux':
      return uninstallLinux()
    default:
      console.error('Windows is not yet supported for daemon mode.')
      process.exit(1)
  }
}

export function getServiceStatus(): ServiceStatus {
  switch (process.platform) {
    case 'darwin':
      return statusMacos()
    case 'linux':
      return statusLinux()
    default:
      return { installed: false, running: false }
  }
}
