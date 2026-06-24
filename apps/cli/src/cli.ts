/**
 * ChatLab CLI entry point
 *
 * Dev: pnpm --filter chatlab-cli run cli -- sessions
 */

import * as fs from 'fs'
import { execSync } from 'child_process'
import { Command } from 'commander'
import { DEFAULT_API_PORT, loadConfig, getConfigPath } from '@openchatlab/config'
import {
  NodePathProvider,
  DatabaseManager,
  AIChatManager,
  applyPendingNodeDataDirMigrationIfNeeded,
  hasPendingElectronDataWarning,
  verifyCliDataPath,
  initAppLogger,
  appLogger,
} from '@openchatlab/node-runtime'
import {
  getSessionMeta,
  getSessionOverview,
  getMemberActivity,
  searchMessagesLike,
  getMembers,
  executeReadonlySql,
} from '@openchatlab/core'
import { getVersion } from './version'
import { resolveCliPath } from './paths'
import { isPortAvailable, formatPortInUseError } from './http/port'
import { assertCliDataDirCompatible } from './runtime-compat'

const program = new Command()

program.name('chatlab').description('ChatLab - Chat history analysis tool').version(getVersion(), '-v, --version')

program.hook('preAction', async (_thisCommand, actionCommand) => {
  if (actionCommand.name() === 'update') return
  const { checkForUpdatesInteractive } = await import('./update-checker')
  await checkForUpdatesInteractive()
})

program
  .command('update')
  .description('Update ChatLab CLI to the latest version')
  .action(async () => {
    const { performCliSelfUpdate } = await import('./update-checker')
    const result = await performCliSelfUpdate({
      write: (text) => process.stderr.write(text),
    })

    if (result.success) {
      console.error('  Updated successfully. Please restart chatlab to use the new version.\n')
      return
    }

    console.error(`  Update failed: ${result.error || 'unknown error'}\n`)
    process.exitCode = 1
  })

program
  .command('sessions')
  .description('List all imported chat sessions')
  .option('--format <format>', 'Output format (table|json)', 'table')
  .action((options) => {
    const { dbManager } = initRuntime()
    const sessionIds = dbManager.listSessionIds()

    if (sessionIds.length === 0) {
      console.log('No chat sessions found.')
      console.log(`Data directory: ${dbManager['pathProvider'].getUserDataDir()}`)
      dbManager.closeAll()
      return
    }

    const sessions = sessionIds
      .map((id) => {
        const db = dbManager.open(id)
        if (!db) return null
        const meta = getSessionMeta(db)
        if (!meta) return null
        const overview = getSessionOverview(db)
        return { id, ...meta, ...overview }
      })
      .filter(Boolean)

    if (options.format === 'json') {
      console.log(JSON.stringify(sessions, null, 2))
    } else {
      console.log(`${sessions.length} session(s) found:\n`)
      for (const s of sessions) {
        if (!s) continue
        const timeRange = formatTimeRange(s.firstMessageTs, s.lastMessageTs)
        console.log(`  ${s.name}`)
        console.log(`    ID: ${s.id}`)
        console.log(
          `    Platform: ${s.platform} | Type: ${s.type} | Members: ${s.totalMembers} | Messages: ${s.totalMessages}`
        )
        if (timeRange) console.log(`    Range: ${timeRange}`)
        console.log()
      }
    }

    dbManager.closeAll()
  })

program
  .command('stats <session-id>')
  .description('Show session statistics overview')
  .option('--format <format>', 'Output format (table|json)', 'table')
  .option('--top <n>', 'Show top N active members', '10')
  .action((sessionId, options) => {
    const { dbManager } = initRuntime()
    const db = dbManager.open(sessionId)
    if (!db) {
      console.error(`Session ${sessionId} not found`)
      process.exit(1)
    }

    const meta = getSessionMeta(db)
    const overview = getSessionOverview(db)
    const topMembers = getMemberActivity(db).slice(0, parseInt(options.top))

    if (options.format === 'json') {
      console.log(JSON.stringify({ meta, overview, topMembers }, null, 2))
    } else {
      console.log(`\nSession: ${meta?.name}`)
      console.log(`Platform: ${meta?.platform} | Type: ${meta?.type}`)
      console.log(`Total messages: ${overview.totalMessages}`)
      console.log(`Total members: ${overview.totalMembers}`)
      console.log(`Time range: ${formatTimeRange(overview.firstMessageTs, overview.lastMessageTs)}`)

      if (topMembers.length > 0) {
        console.log(`\nActivity ranking (Top ${options.top}):`)
        for (const [i, m] of topMembers.entries()) {
          console.log(`  ${i + 1}. ${m.name} - ${m.messageCount} messages (${m.percentage}%)`)
        }
      }
    }

    dbManager.closeAll()
  })

program
  .command('search <session-id> <keyword>')
  .description('Search messages by keyword')
  .option('--limit <n>', 'Max results to return', '20')
  .option('--format <format>', 'Output format (table|json)', 'table')
  .action((sessionId, keyword, options) => {
    const { dbManager } = initRuntime()
    const db = dbManager.open(sessionId)
    if (!db) {
      console.error(`Session ${sessionId} not found`)
      process.exit(1)
    }

    const limit = parseInt(options.limit)
    const result = searchMessagesLike(db, keyword, { limit })

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(
        `Search "${keyword}" - ${result.total} result(s)${result.hasMore ? ' (showing first ' + limit + ')' : ''}:\n`
      )
      for (const msg of result.messages) {
        const time = new Date(msg.timestamp * 1000).toLocaleString()
        console.log(`  [${time}] ${msg.senderName}: ${msg.content}`)
      }
    }

    dbManager.closeAll()
  })

program
  .command('members <session-id>')
  .description('List session members')
  .option('--format <format>', 'Output format (table|json)', 'table')
  .action((sessionId, options) => {
    const { dbManager } = initRuntime()
    const db = dbManager.open(sessionId)
    if (!db) {
      console.error(`Session ${sessionId} not found`)
      process.exit(1)
    }

    const members = getMembers(db)

    if (options.format === 'json') {
      console.log(JSON.stringify(members, null, 2))
    } else {
      console.log(`${members.length} member(s):\n`)
      for (const [i, m] of members.entries()) {
        console.log(`  ${i + 1}. ${m.name} (${m.platformId}) - ${m.messageCount} messages`)
      }
    }

    dbManager.closeAll()
  })

program
  .command('query <session-id>')
  .description('Execute a read-only SQL query on a session database')
  .requiredOption('--sql <sql>', 'SQL query statement')
  .option('--format <format>', 'Output format (table|json)', 'table')
  .action((sessionId, options) => {
    const { dbManager } = initRuntime()
    const db = dbManager.open(sessionId)
    if (!db) {
      console.error(`Session ${sessionId} not found`)
      process.exit(1)
    }

    try {
      const result = executeReadonlySql(db, options.sql)
      if (options.format === 'json') {
        console.log(JSON.stringify(result, null, 2))
      } else {
        if (result.rows.length === 0) {
          console.log('No results.')
        } else {
          printTable(result.columns, result.rows)
          console.log(`\n${result.rowCount} row(s)${result.truncated ? ' (truncated)' : ''}`)
        }
      }
    } catch (err) {
      console.error(`SQL error: ${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }

    dbManager.closeAll()
  })

program
  .command('import <file>')
  .description('Import a chat history file (14+ formats: QQ/WeChat/Telegram/WhatsApp/LINE/Discord/Instagram, etc.)')
  .option('--session-id <id>', 'Specify session ID (auto-generated if omitted)')
  .option('--format <id>', 'Specify format ID (skip auto-detection)')
  .action(async (file, options) => {
    if (!fs.existsSync(file)) {
      console.error(`File not found: ${file}`)
      process.exit(1)
    }

    const { streamImport, detectFormat } = await import('./import')
    const { dbManager, pathProvider } = initRuntime()
    const nativeBinding = resolveNativeBinding()

    const format = detectFormat(file)
    if (!format && !options.format) {
      console.error(`Unrecognized file format: ${file}`)
      console.error('Use --format <id> to specify manually, or run "chatlab formats" to see supported formats')
      process.exit(1)
    }

    console.log(`Importing: ${file}`)
    if (format) console.log(`  Format: ${format.name} (${format.platform})`)

    try {
      const result = await streamImport(dbManager, file, {
        formatId: options.format,
        nativeBinding,
        onProgress: (p) => {
          process.stdout.write(`\r  ${p.stage}: ${p.progress}%`)
        },
      })

      if (result.success) {
        console.log(`\n\nImport succeeded!`)
        console.log(`  Session ID: ${result.sessionId}`)
        console.log(`  Messages written: ${result.diagnostics?.messagesWritten ?? 0}`)
        console.log(`  Messages skipped: ${result.diagnostics?.messagesSkipped ?? 0}`)

        if (result.sessionId) {
          try {
            const { PreferencesManager, createDatabaseManagerAdapter, ownerProfileService } =
              await import('@openchatlab/node-runtime')
            const applied = ownerProfileService.tryApplyOwnerProfile(
              createDatabaseManagerAdapter(dbManager),
              new PreferencesManager(pathProvider.getSystemDir()),
              result.sessionId
            )
            if (applied.applied) {
              console.log(`  Owner auto-detected: ${applied.ownerId}`)
            }
          } catch (ownerErr) {
            console.warn(`  Owner profile apply skipped: ${ownerErr instanceof Error ? ownerErr.message : ownerErr}`)
          }
        }
      } else {
        console.error(`\n\nImport failed: ${result.error}`)
        process.exit(1)
      }
    } catch (err) {
      console.error(`\n\nImport error: ${err instanceof Error ? err.message : err}`)
      process.exit(1)
    } finally {
      dbManager.closeAll()
    }
  })

program
  .command('formats')
  .description('List all supported chat history formats')
  .action(async () => {
    const { getSupportedFormats } = await import('./import')
    const formats = getSupportedFormats()
    console.log(`${formats.length} supported format(s):\n`)
    for (const f of formats) {
      console.log(`  ${f.id.padEnd(30)} ${f.name} (${f.platform}) [${f.extensions.join(', ')}]`)
    }
  })

program
  .command('mcp')
  .description('Start MCP Server (stdio transport, for ClaudeCode / Cursor / AI agents)')
  .action(async () => {
    const { startCliMcpServer } = await import('./mcp')
    await startCliMcpServer()
  })

program
  .command('chat')
  .description('Ask ChatLab AI about an imported chat session')
  .option('--session-id <id>', 'Source chat session ID')
  .option('--ai-chat-id <id>', 'Existing AI chat ID to continue')
  .option('-q, --question <text>', 'Question to ask')
  .option('--json', 'Output structured JSON')
  .option('--include-events', 'Include all agent stream chunks in JSON output')
  .option('--no-stream', 'Disable streaming output')
  .option('--locale <locale>', 'AI response locale', 'zh-CN')
  .action(async (options) => {
    const { runChatCommand } = await import('./ai/chat-command')
    const { dbManager, pathProvider } = initRuntime()
    const aiChatManager = new AIChatManager(pathProvider.getAiDataDir(), { nativeBinding: resolveNativeBinding() })

    try {
      await runChatCommand(
        {
          sessionId: options.sessionId,
          aiChatId: options.aiChatId,
          question: options.question,
          json: !!options.json,
          stream: options.stream,
          locale: options.locale,
          includeEvents: !!options.includeEvents,
        },
        { dbManager, pathProvider, aiChatManager }
      )
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    } finally {
      aiChatManager.close()
      dbManager.closeAll()
    }
  })

program
  .command('start')
  .description('Start ChatLab (HTTP API + Web UI)')
  .option('--port <port>', 'Server port', String(DEFAULT_API_PORT))
  .option('--host <host>', 'Listen address', '127.0.0.1')
  .option('--token <token>', 'Custom Bearer Token (reads from config or auto-generates if omitted)')
  .option('--headless', 'API-only mode, do not serve the Web UI')
  .option('--require-auth', 'Require Bearer token for all routes including /_web/*')
  .option('--no-open', 'Do not auto-open the browser')
  .option('--daemon', 'Run as a resident system service (auto-start on login, macOS/Linux)')
  .action(async (options) => {
    // --daemon: install as system service and exit
    if (options.daemon) {
      const { serviceInstall } = await import('./daemon/service')
      serviceInstall({
        port: parseInt(options.port, 10),
        host: options.host,
        token: options.token || undefined,
        headless: options.headless,
        requireAuth: options.requireAuth || undefined,
      })
      return
    }

    const { startHttpServer } = await import('./http')
    const port = parseInt(options.port, 10)

    let webRoot: string | undefined
    if (!options.headless) {
      const webDir = resolveCliPath('dist-web')
      if (fs.existsSync(webDir)) {
        webRoot = webDir
      } else {
        console.warn('Warning: dist-web/ not found, starting in API-only mode')
      }
    }

    try {
      // 启动前预检端口，快速失败，避免无谓的初始化后再报 EADDRINUSE；
      // 置于 try 内确保非 EADDRINUSE 错误（EACCES/EADDRNOTAVAIL 等）
      // 也能走到统一的 Startup failed 错误处理路径。
      if (!(await isPortAvailable(port, options.host))) {
        console.error(formatPortInUseError(port))
        process.exit(1)
      }

      const info = await startHttpServer({
        port,
        host: options.host,
        token: options.token || undefined,
        webRoot,
        requireAuth: options.requireAuth || undefined,
      })

      const { startPeriodicUpdateCheck } = await import('./update-checker')
      startPeriodicUpdateCheck()

      const displayHost = info.host === '0.0.0.0' ? '127.0.0.1' : info.host
      const url = `http://${displayHost}:${info.port}`

      console.log(`\nChatLab v${getVersion()}`)
      if (webRoot) console.log(`  Web UI: ${url}/`)
      console.log(`  API:    ${url}`)
      console.log(`  Token:  ${info.token}`)
      console.log(`\nExample:`)
      console.log(`  curl -H "Authorization: Bearer ${info.token}" ${url}/api/v1/status`)

      if (webRoot && options.open) {
        openBrowser(url)
        console.log(`\nBrowser opened. Press Ctrl+C to stop.\n`)
      } else {
        console.log(`\nPress Ctrl+C to stop.\n`)
      }

      const shutdown = async () => {
        console.log('\nShutting down...')
        const { stopHttpServer } = await import('./http')
        await stopHttpServer()
        process.exit(0)
      }

      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('EADDRINUSE')) {
        // 极低概率的 TOCTOU 竞态（预检通过后端口被占），复用统一文案
        console.error(formatPortInUseError(port))
      } else {
        console.error(`Startup failed: ${message}`)
      }
      process.exit(1)
    }
  })

const configCmd = program.command('config').description('Configuration management')

configCmd
  .command('path')
  .description('Show config file path')
  .action(() => {
    console.log(getConfigPath())
  })

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const config = loadConfig()
    console.log(JSON.stringify(config, null, 2))
  })

program
  .command('stop')
  .description('Stop the resident service and remove auto-start (reverse of start --daemon)')
  .action(async () => {
    const { serviceUninstall } = await import('./daemon/service')
    serviceUninstall()
  })

program
  .command('status')
  .description('Show resident service status')
  .action(async () => {
    const { getServiceStatus } = await import('./daemon/service')
    const svc = getServiceStatus()

    console.log('\nChatLab Status')
    console.log('─'.repeat(36))
    console.log(`  Logs:       ${new NodePathProvider().getLogsDir()}`)

    if (svc.installed) {
      const portStr = svc.port ? `http://${svc.host ?? '127.0.0.1'}:${svc.port}` : ''
      console.log(`  Service:    ${svc.running ? 'running' : 'installed (not running)'}`)
      if (portStr) console.log(`  Address:    ${portStr}`)
      console.log(`  Auto-start: enabled`)
      console.log(`\n  Use \`chatlab stop\` to remove the service.\n`)
    } else {
      console.log(`  Service:    not installed`)
      console.log(`  Auto-start: disabled`)
      console.log(`\n  Use \`chatlab start --daemon\` to install as a system service.\n`)
    }
  })

// --- 工具函数 ---

function openBrowser(url: string): void {
  try {
    const cmd =
      process.platform === 'darwin'
        ? `open "${url}"`
        : process.platform === 'win32'
          ? `start "" "${url}"`
          : `xdg-open "${url}"`
    execSync(cmd, { stdio: 'ignore' })
  } catch {
    console.log(`  Open manually: ${url}`)
  }
}

/**
 * Resolve standalone better-sqlite3 native module path.
 * Used in non-Electron environments to avoid electron-rebuild conflicts.
 */
function resolveNativeBinding(): string | undefined {
  if (process.versions.electron) return undefined
  const nativePath = resolveCliPath('native/better_sqlite3.node')
  if (fs.existsSync(nativePath)) return nativePath
  return undefined
}

function initRuntime() {
  let config = loadConfig()
  const pendingMigration = applyPendingNodeDataDirMigrationIfNeeded()
  if (!pendingMigration.skipped) {
    if (pendingMigration.success) {
      console.log('[Migration] Pending data directory migration completed')
      config = loadConfig()
    } else {
      console.error('[Migration] Pending data directory migration failed:', pendingMigration.error)
    }
  }
  const userDataDir = config.data.user_data_dir || undefined
  const pathProvider = new NodePathProvider(userDataDir)
  pathProvider.ensureAllDirs()
  const runtime = assertCliDataDirCompatible(pathProvider, 'cli')

  if (hasPendingElectronDataWarning() || !verifyCliDataPath(pathProvider.getDatabaseDir())) {
    printElectronDataError()
    process.exit(1)
  }

  const nativeBinding = resolveNativeBinding()
  const dbManager = new DatabaseManager(pathProvider, { nativeBinding, runtime })
  return { config, pathProvider, dbManager }
}

function printElectronDataError(): void {
  console.error('\n' + '='.repeat(68))
  console.error('  ChatLab: Electron desktop data not found')
  console.error('='.repeat(68))
  console.error('')
  console.error('  Detected that ChatLab desktop app was installed on this machine,')
  console.error('  but could not locate your chat databases.')
  console.error('')
  console.error('  This usually means you changed the data directory in desktop settings.')
  console.error('')
  console.error('  To fix this, choose one of:')
  console.error('')
  console.error('  1. Open ChatLab desktop app — it will auto-migrate your data')
  console.error('  2. Set the data directory manually:')
  console.error('     export CHATLAB_DATA_DIR="/path/to/your/data"')
  console.error('  3. Edit ~/.chatlab/config.toml:')
  console.error('     [data]')
  console.error('     user_data_dir = "/path/to/your/data"')
  console.error('')
  console.error('='.repeat(68) + '\n')
}

function formatTimeRange(first: number | null, last: number | null): string {
  if (!first || !last) return 'Unknown'
  const from = new Date(first * 1000).toLocaleDateString()
  const to = new Date(last * 1000).toLocaleDateString()
  return `${from} ~ ${to}`
}

function printTable(columns: string[], rows: Record<string, unknown>[]): void {
  const widths = columns.map((col) => {
    const maxData = rows.reduce((max, row) => {
      const val = String(row[col] ?? '')
      return Math.max(max, val.length)
    }, 0)
    return Math.max(col.length, Math.min(maxData, 40))
  })

  const header = columns.map((col, i) => col.padEnd(widths[i])).join(' | ')
  const separator = widths.map((w) => '-'.repeat(w)).join('-+-')
  console.log(header)
  console.log(separator)

  for (const row of rows) {
    const line = columns
      .map((col, i) => {
        const val = String(row[col] ?? '')
        return val.length > 40 ? val.slice(0, 37) + '...' : val.padEnd(widths[i])
      })
      .join(' | ')
    console.log(line)
  }
}

/** CLI entry function */
export function run(argv?: string[]): void {
  // Logs go to ~/.chatlab/logs/app.log regardless of configured user data dir.
  initAppLogger(new NodePathProvider().getLogsDir())
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error)
    appLogger.error('crash', 'uncaughtException', error)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason)
    appLogger.error('crash', 'unhandledRejection', reason)
  })
  program.parse(argv)
}

// Auto-execute when run directly as a script
const isDirectRun = process.argv[1]?.endsWith('cli.ts') || process.argv[1]?.endsWith('cli.js')
if (isDirectRun) {
  run()
}
