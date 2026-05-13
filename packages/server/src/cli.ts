/**
 * ChatLab CLI 入口
 *
 * 使用 commander 定义命令结构。
 * 开发阶段运行方式：pnpm --filter chatlab cli -- sessions
 */

import * as fs from 'fs'
import * as path from 'path'
import { Command } from 'commander'
import { loadConfig, getConfigPath } from '@openchatlab/config'
import { NodePathProvider, DatabaseManager } from '@openchatlab/node-runtime'
import {
  getSessionMeta,
  getSessionOverview,
  getMemberActivity,
  searchMessagesLike,
  getMembers,
  executeReadonlySql,
} from '@openchatlab/core'

const program = new Command()

program.name('chatlab').description('ChatLab - 聊天记录分析工具').version('0.0.1')

// chatlab sessions - 列出所有会话
program
  .command('sessions')
  .description('列出所有已导入的聊天会话')
  .option('--format <format>', '输出格式 (table|json)', 'table')
  .action((options) => {
    const { dbManager } = initRuntime()
    const sessionIds = dbManager.listSessionIds()

    if (sessionIds.length === 0) {
      console.log('没有找到任何聊天会话。')
      console.log(`数据目录: ${dbManager['pathProvider'].getDataDir()}`)
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
      console.log(`共 ${sessions.length} 个会话:\n`)
      for (const s of sessions) {
        if (!s) continue
        const timeRange = formatTimeRange(s.firstMessageTs, s.lastMessageTs)
        console.log(`  ${s.name}`)
        console.log(`    ID: ${s.id}`)
        console.log(`    平台: ${s.platform} | 类型: ${s.type} | 成员: ${s.totalMembers} | 消息: ${s.totalMessages}`)
        if (timeRange) console.log(`    时间: ${timeRange}`)
        console.log()
      }
    }

    dbManager.closeAll()
  })

// chatlab stats <session-id> - 会话统计
program
  .command('stats <session-id>')
  .description('查看会话统计概览')
  .option('--format <format>', '输出格式 (table|json)', 'table')
  .option('--top <n>', '显示前 N 个活跃成员', '10')
  .action((sessionId, options) => {
    const { dbManager } = initRuntime()
    const db = dbManager.open(sessionId)
    if (!db) {
      console.error(`会话 ${sessionId} 不存在`)
      process.exit(1)
    }

    const meta = getSessionMeta(db)
    const overview = getSessionOverview(db)
    const topMembers = getMemberActivity(db).slice(0, parseInt(options.top))

    if (options.format === 'json') {
      console.log(JSON.stringify({ meta, overview, topMembers }, null, 2))
    } else {
      console.log(`\n会话: ${meta?.name}`)
      console.log(`平台: ${meta?.platform} | 类型: ${meta?.type}`)
      console.log(`消息总数: ${overview.totalMessages}`)
      console.log(`成员总数: ${overview.totalMembers}`)
      console.log(`时间范围: ${formatTimeRange(overview.firstMessageTs, overview.lastMessageTs)}`)

      if (topMembers.length > 0) {
        console.log(`\n活跃度排行 (Top ${options.top}):`)
        for (const [i, m] of topMembers.entries()) {
          console.log(`  ${i + 1}. ${m.name} - ${m.messageCount} 条 (${m.percentage}%)`)
        }
      }
    }

    dbManager.closeAll()
  })

// chatlab search <session-id> <keyword> - 搜索消息
program
  .command('search <session-id> <keyword>')
  .description('在聊天记录中搜索关键词')
  .option('--limit <n>', '返回条数', '20')
  .option('--format <format>', '输出格式 (table|json)', 'table')
  .action((sessionId, keyword, options) => {
    const { dbManager } = initRuntime()
    const db = dbManager.open(sessionId)
    if (!db) {
      console.error(`会话 ${sessionId} 不存在`)
      process.exit(1)
    }

    const limit = parseInt(options.limit)
    const result = searchMessagesLike(db, keyword, { limit })

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(
        `搜索 "${keyword}" - 共 ${result.total} 条结果${result.hasMore ? '（显示前 ' + limit + ' 条）' : ''}:\n`
      )
      for (const msg of result.messages) {
        const time = new Date(msg.timestamp * 1000).toLocaleString()
        console.log(`  [${time}] ${msg.senderName}: ${msg.content}`)
      }
    }

    dbManager.closeAll()
  })

// chatlab members <session-id> - 成员列表
program
  .command('members <session-id>')
  .description('查看成员列表')
  .option('--format <format>', '输出格式 (table|json)', 'table')
  .action((sessionId, options) => {
    const { dbManager } = initRuntime()
    const db = dbManager.open(sessionId)
    if (!db) {
      console.error(`会话 ${sessionId} 不存在`)
      process.exit(1)
    }

    const members = getMembers(db)

    if (options.format === 'json') {
      console.log(JSON.stringify(members, null, 2))
    } else {
      console.log(`共 ${members.length} 个成员:\n`)
      for (const [i, m] of members.entries()) {
        console.log(`  ${i + 1}. ${m.name} (${m.platformId}) - ${m.messageCount} 条消息`)
      }
    }

    dbManager.closeAll()
  })

// chatlab query <session-id> --sql "..." - 执行 SQL
program
  .command('query <session-id>')
  .description('对会话数据库执行只读 SQL 查询')
  .requiredOption('--sql <sql>', 'SQL 查询语句')
  .option('--format <format>', '输出格式 (table|json)', 'table')
  .action((sessionId, options) => {
    const { dbManager } = initRuntime()
    const db = dbManager.open(sessionId)
    if (!db) {
      console.error(`会话 ${sessionId} 不存在`)
      process.exit(1)
    }

    try {
      const result = executeReadonlySql(db, options.sql)
      if (options.format === 'json') {
        console.log(JSON.stringify(result, null, 2))
      } else {
        if (result.rows.length === 0) {
          console.log('查询无结果。')
        } else {
          printTable(result.columns, result.rows)
          console.log(`\n共 ${result.rowCount} 行${result.truncated ? '（已截断）' : ''}`)
        }
      }
    } catch (err) {
      console.error(`SQL 执行错误: ${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }

    dbManager.closeAll()
  })

// chatlab import <file> - 导入聊天记录
program
  .command('import <file>')
  .description('导入聊天记录文件（支持 14+ 格式：QQ/WeChat/Telegram/WhatsApp/LINE/Discord/Instagram 等）')
  .option('--session-id <id>', '指定会话 ID（不指定则自动生成）')
  .option('--format <id>', '指定格式 ID（跳过自动检测）')
  .action(async (file, options) => {
    if (!fs.existsSync(file)) {
      console.error(`文件不存在: ${file}`)
      process.exit(1)
    }

    const { streamImport, detectFormat } = await import('./import')
    const { dbManager } = initRuntime()
    const nativeBinding = resolveNativeBinding()

    const format = detectFormat(file)
    if (!format && !options.format) {
      console.error(`无法识别文件格式: ${file}`)
      console.error('使用 --format <id> 手动指定格式，或使用 chatlab formats 查看支持的格式列表')
      process.exit(1)
    }

    console.log(`导入文件: ${file}`)
    if (format) console.log(`  格式: ${format.name} (${format.platform})`)

    try {
      const result = await streamImport(dbManager, file, {
        formatId: options.format,
        nativeBinding,
        onProgress: (p) => {
          const labels: Record<string, string> = {
            detecting: '检测格式',
            parsing: '解析中',
            saving: '写入数据库',
            indexing: '建立索引',
            done: '完成',
            error: '错误',
          }
          process.stdout.write(`\r  ${labels[p.stage] || p.stage}: ${p.progress}%`)
        },
      })

      if (result.success) {
        console.log(`\n\n导入成功!`)
        console.log(`  会话 ID: ${result.sessionId}`)
        console.log(`  写入消息: ${result.messageCount}`)
        console.log(`  成员数: ${result.memberCount}`)
      } else {
        console.error(`\n\n导入失败: ${result.error}`)
        process.exit(1)
      }
    } catch (err) {
      console.error(`\n\n导入错误: ${err instanceof Error ? err.message : err}`)
      process.exit(1)
    } finally {
      dbManager.closeAll()
    }
  })

// chatlab formats - 列出支持的格式
program
  .command('formats')
  .description('列出所有支持的聊天记录格式')
  .action(async () => {
    const { getSupportedFormats } = await import('./import')
    const formats = getSupportedFormats()
    console.log(`支持 ${formats.length} 种格式:\n`)
    for (const f of formats) {
      console.log(`  ${f.id.padEnd(30)} ${f.name} (${f.platform}) [${f.extensions.join(', ')}]`)
    }
  })

// chatlab mcp - MCP Server
program
  .command('mcp')
  .description('启动 MCP Server（stdio 传输，供 Claude Desktop / Cursor 等 AI 代理使用）')
  .action(async () => {
    const { startMcpServer } = await import('./mcp')
    await startMcpServer()
  })

// chatlab serve - 启动 HTTP API 服务
program
  .command('serve')
  .description('启动独立 HTTP API 服务')
  .option('--port <port>', '服务端口', '3210')
  .option('--host <host>', '监听地址', '127.0.0.1')
  .option('--token <token>', '自定义 Bearer Token（不指定则从配置文件读取或自动生成）')
  .option('--web [dir]', '托管 Web 前端静态资源（默认查找 dist-web/）')
  .action(async (options) => {
    const { startHttpServer } = await import('./http')
    const port = parseInt(options.port, 10)

    let webRoot: string | undefined
    if (options.web !== undefined) {
      const webDir = typeof options.web === 'string' ? options.web : path.resolve(__dirname, '../../dist-web')
      if (fs.existsSync(webDir)) {
        webRoot = path.resolve(webDir)
      } else {
        console.warn(`警告: Web 目录不存在: ${webDir}，将仅启动 API 服务`)
      }
    }

    try {
      const info = await startHttpServer({
        port,
        host: options.host,
        token: options.token || undefined,
        webRoot,
      })

      console.log(`\nChatLab HTTP API 已启动`)
      console.log(`  地址: http://${info.host}:${info.port}`)
      console.log(`  Token: ${info.token}`)
      if (webRoot) {
        console.log(`  Web UI: http://${info.host}:${info.port}/`)
      }
      console.log(`\n示例:`)
      console.log(`  curl -H "Authorization: Bearer ${info.token}" http://${info.host}:${info.port}/api/v1/status`)
      console.log(`\n按 Ctrl+C 停止服务\n`)

      const shutdown = async () => {
        console.log('\n正在停止服务...')
        const { stopHttpServer } = await import('./http')
        await stopHttpServer()
        process.exit(0)
      }

      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('EADDRINUSE')) {
        console.error(`错误: 端口 ${port} 已被占用`)
      } else {
        console.error(`启动失败: ${message}`)
      }
      process.exit(1)
    }
  })

// chatlab config - 配置管理
const configCmd = program.command('config').description('配置管理')

configCmd
  .command('path')
  .description('显示配置文件路径')
  .action(() => {
    console.log(getConfigPath())
  })

configCmd
  .command('show')
  .description('显示当前配置')
  .action(() => {
    const config = loadConfig()
    console.log(JSON.stringify(config, null, 2))
  })

// --- 工具函数 ---

/**
 * 查找独立编译的 better-sqlite3 原生模块路径。
 * 在非 Electron 环境下使用，避免与 electron-rebuild 冲突。
 */
function resolveNativeBinding(): string | undefined {
  if (process.versions.electron) return undefined
  const nativePath = path.resolve(__dirname, '../native/better_sqlite3.node')
  if (fs.existsSync(nativePath)) return nativePath
  return undefined
}

function initRuntime() {
  const config = loadConfig()
  const dataDir = config.data.dir || undefined
  const pathProvider = new NodePathProvider(dataDir)
  pathProvider.ensureAllDirs()
  const nativeBinding = resolveNativeBinding()
  const dbManager = new DatabaseManager(pathProvider, { nativeBinding })
  return { config, pathProvider, dbManager }
}

function formatTimeRange(first: number | null, last: number | null): string {
  if (!first || !last) return '未知'
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

/**
 * CLI 入口函数
 */
export function run(argv?: string[]): void {
  program.parse(argv)
}

// 作为脚本直接运行时自动执行
const isDirectRun = process.argv[1]?.endsWith('cli.ts') || process.argv[1]?.endsWith('cli.js')
if (isDirectRun) {
  run()
}
