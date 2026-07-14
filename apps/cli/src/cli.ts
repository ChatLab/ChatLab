/**
 * ChatLab CLI entry point
 *
 * Dev: pnpm --filter chatlab-cli run cli -- sessions
 */

import * as fs from 'fs'
import { execSync } from 'child_process'
import { Command } from 'commander'
import { DEFAULT_API_PORT, loadConfig, getConfigPath, setConfigField, ConfigSetError } from '@openchatlab/config'
import { AIChatManager, initAppLogger, appLogger, getSystemLogsDir } from '@openchatlab/node-runtime'
import { getVersion } from './version'
import { resolveCliPath } from './paths'
import { isPortAvailable, formatPortInUseError } from './http/port'
import { initRuntime, resolveNativeBinding } from './runtime'
import { registerQueryCommands } from './query/register'
import { registerManifestCommand } from './query/manifest'
import { registerImportCommand } from './import/command'

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

// Agent-facing query commands (sessions/members/messages/stats/topics/sql)
// plus deprecated top-level aliases; see apps/cli/src/query/.
registerQueryCommands(program)
registerManifestCommand(program, getVersion())

registerImportCommand(program)

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

configCmd
  .command('set <key> <value>')
  .description('Set a config field, e.g. `chatlab config set cli.allow_raw true`')
  .action((key: string, value: string) => {
    try {
      const result = setConfigField(key, value)
      console.log(`${result.section}.${result.key} = ${JSON.stringify(result.value)}`)
    } catch (err) {
      if (err instanceof ConfigSetError) {
        console.error(`Error: ${err.message}`)
        process.exitCode = 2
        return
      }
      throw err
    }
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
    console.log(`  Logs:       ${getSystemLogsDir()}`)

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

/** CLI entry function */
export function run(argv?: string[]): void {
  // Logs go to ~/.chatlab/logs/app.log regardless of configured user data dir.
  initAppLogger(getSystemLogsDir())
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error)
    appLogger.error('crash', 'uncaughtException', error)
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason)
    appLogger.error('crash', 'unhandledRejection', reason)
    process.exit(1)
  })
  program.parse(argv)
}

// Auto-execute when run directly as a script
const isDirectRun = process.argv[1]?.endsWith('cli.ts') || process.argv[1]?.endsWith('cli.js')
if (isDirectRun) {
  run()
}
