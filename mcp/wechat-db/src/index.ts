#!/usr/bin/env node
/**
 * ChatLab MCP Server — 微信 4.x 数据库直连工具
 *
 * 提供 MCP 工具让 Claude 直接查询 macOS 微信 4.x 加密数据库，
 * 无需手动导出聊天记录。
 *
 * 使用方式：
 *   WECHAT_KEY=<密钥> node dist/index.js
 *
 * 在 Claude Desktop 中配置：
 *   {
 *     "mcpServers": {
 *       "wechat-db": {
 *         "command": "node",
 *         "args": ["/path/to/chatlab/mcp/wechat-db/dist/index.js"],
 *         "env": { "WECHAT_KEY": "your_key_here" }
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import Database from 'better-sqlite3-multiple-ciphers'
import {
  listWeChatAccounts,
  getAccountPaths,
  openWeChatDatabase,
  querySessions,
  queryContacts,
  queryMessagesFromShard,
  queryMessagesAllShards,
  executeCustomSQL,
  getDatabaseSchema,
  type CipherConfig,
} from './wechat-db.js'
import { existsSync } from 'node:fs'

// ============================
// 工具输入 Schema 定义
// ============================

const ListAccountsSchema = z.object({})

const ListSessionsSchema = z.object({
  wxid_or_path: z.string().describe('账户 wxid 或完整路径（从 list_accounts 获取）'),
  limit: z.number().optional().default(50).describe('返回数量，默认 50'),
  offset: z.number().optional().default(0).describe('偏移量，默认 0'),
})

const ListContactsSchema = z.object({
  wxid_or_path: z.string().describe('账户 wxid 或完整路径'),
  search: z.string().optional().describe('搜索关键词（匹配昵称、备注、wxid、alias）'),
  limit: z.number().optional().default(100).describe('返回数量，默认 100'),
  offset: z.number().optional().default(0).describe('偏移量，默认 0'),
})

const QueryMessagesSchema = z.object({
  wxid_or_path: z.string().describe('账户 wxid 或完整路径'),
  talker: z.string().optional().describe('聊天对象 wxid（私聊）或群 ID（chatroom）'),
  keyword: z.string().optional().describe('消息内容关键词搜索'),
  start_time: z
    .number()
    .optional()
    .describe('开始时间（Unix 时间戳，秒），如 1700000000'),
  end_time: z
    .number()
    .optional()
    .describe('结束时间（Unix 时间戳，秒），如 1700086400'),
  is_sender: z
    .number()
    .optional()
    .describe('1=只看自己发送的，0=只看对方发送的，不传=全部'),
  limit: z.number().optional().default(100).describe('返回数量，默认 100'),
  shard: z
    .number()
    .optional()
    .describe('指定消息分片序号（0-9），不传则查询所有分片'),
})

const GetDatabaseSchemaSchema = z.object({
  wxid_or_path: z.string().describe('账户 wxid 或完整路径'),
  db_type: z
    .enum(['contact', 'message'])
    .describe("数据库类型：'contact'=联系人库, 'message'=消息库"),
  shard: z
    .number()
    .optional()
    .default(0)
    .describe('消息分片序号（0-9），仅 db_type=message 时有效'),
})

const ExecuteSQLSchema = z.object({
  wxid_or_path: z.string().describe('账户 wxid 或完整路径'),
  db_type: z
    .enum(['contact', 'message'])
    .describe("数据库类型：'contact'=联系人库, 'message'=消息库"),
  shard: z
    .number()
    .optional()
    .default(0)
    .describe('消息分片序号（0-9），仅 db_type=message 时有效'),
  sql: z.string().describe('要执行的 SQL 语句（只允许 SELECT/WITH/PRAGMA）'),
})

const SetKeySchema = z.object({
  key: z
    .string()
    .describe(
      '解密密钥。格式：原始密码字符串，或 "hex:xxxxxx"（十六进制格式的 32 字节密钥）'
    ),
  page_size: z.number().optional().describe('cipher_page_size，默认 4096（微信默认值）'),
  kdf_iter: z.number().optional().describe('kdf_iter，默认 64000（微信默认值）'),
  hmac_algo: z.string().optional().describe('HMAC 算法，默认 HMAC_SHA1（微信默认值）'),
  kdf_algo: z.string().optional().describe('KDF 算法，默认 PBKDF2_HMAC_SHA1（微信默认值）'),
})

// ============================
// 全局状态：当前密钥配置
// ============================

let currentCipherConfig: CipherConfig | null = null

function getCipherConfig(): CipherConfig {
  if (currentCipherConfig) return currentCipherConfig

  // 尝试从环境变量读取
  const envKey = process.env.WECHAT_KEY
  if (envKey) {
    currentCipherConfig = {
      key: envKey,
      pageSize: process.env.WECHAT_PAGE_SIZE ? Number(process.env.WECHAT_PAGE_SIZE) : 4096,
      kdfIter: process.env.WECHAT_KDF_ITER ? Number(process.env.WECHAT_KDF_ITER) : 64000,
      hmacAlgo: process.env.WECHAT_HMAC_ALGO ?? 'HMAC_SHA1',
      kdfAlgo: process.env.WECHAT_KDF_ALGO ?? 'PBKDF2_HMAC_SHA1',
    }
    return currentCipherConfig
  }

  throw new Error(
    '未设置解密密钥。请通过以下任一方式提供：\n' +
      '1. 环境变量 WECHAT_KEY=<密钥>\n' +
      '2. 调用 wechat_set_key 工具设置密钥'
  )
}

function withDb<T>(
  dbPath: string,
  fn: (db: Database.Database) => T
): T {
  const config = getCipherConfig()
  const db = openWeChatDatabase(dbPath, config)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

// ============================
// MCP Server
// ============================

const server = new Server(
  {
    name: 'chatlab-wechat-db',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// ---- 工具列表 ----

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'wechat_set_key',
        description:
          '设置微信数据库解密密钥。密钥可通过读取微信进程内存获取（参考 PyWxDump 等工具）。' +
          '设置后对本次会话生效。也可通过环境变量 WECHAT_KEY 预先配置。',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description:
                '解密密钥。原始密码字符串，或 "hex:xxxxxx"（十六进制格式，如 "hex:0a1b2c3d..."）',
            },
            page_size: { type: 'number', description: 'cipher_page_size，默认 4096' },
            kdf_iter: { type: 'number', description: 'kdf_iter，默认 64000' },
            hmac_algo: { type: 'string', description: 'HMAC 算法，默认 HMAC_SHA1' },
            kdf_algo: { type: 'string', description: 'KDF 算法，默认 PBKDF2_HMAC_SHA1' },
          },
          required: ['key'],
        },
      },
      {
        name: 'wechat_list_accounts',
        description:
          '列出 macOS 上所有微信 4.x 账户。返回 wxid 和数据库路径，用于后续查询工具的 wxid_or_path 参数。',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'wechat_list_sessions',
        description: '列出指定账户的聊天会话列表（最近联系人/群聊），按活跃时间排序。',
        inputSchema: {
          type: 'object',
          properties: {
            wxid_or_path: {
              type: 'string',
              description: '账户 wxid 或完整路径（从 wechat_list_accounts 获取）',
            },
            limit: { type: 'number', description: '返回数量，默认 50' },
            offset: { type: 'number', description: '偏移量，默认 0' },
          },
          required: ['wxid_or_path'],
        },
      },
      {
        name: 'wechat_list_contacts',
        description: '查询联系人列表，支持按昵称/备注/wxid/alias 搜索。',
        inputSchema: {
          type: 'object',
          properties: {
            wxid_or_path: {
              type: 'string',
              description: '账户 wxid 或完整路径',
            },
            search: {
              type: 'string',
              description: '搜索关键词（匹配昵称、备注、wxid、alias）',
            },
            limit: { type: 'number', description: '返回数量，默认 100' },
            offset: { type: 'number', description: '偏移量，默认 0' },
          },
          required: ['wxid_or_path'],
        },
      },
      {
        name: 'wechat_query_messages',
        description:
          '查询消息记录。支持按聊天对象、关键词、时间范围、发送方向筛选。' +
          '消息存储在多个分片数据库（msg_0.db 到 msg_9.db）中，' +
          '不指定 shard 时会查询所有分片并合并结果。',
        inputSchema: {
          type: 'object',
          properties: {
            wxid_or_path: {
              type: 'string',
              description: '账户 wxid 或完整路径',
            },
            talker: {
              type: 'string',
              description: '聊天对象 wxid（私聊）或群 ID（以 @chatroom 结尾）',
            },
            keyword: { type: 'string', description: '消息内容关键词' },
            start_time: {
              type: 'number',
              description: '开始时间（Unix 时间戳，秒）',
            },
            end_time: {
              type: 'number',
              description: '结束时间（Unix 时间戳，秒）',
            },
            is_sender: {
              type: 'number',
              description: '1=只看自己发出的，0=只看对方发出的，不传=全部',
            },
            limit: { type: 'number', description: '返回数量，默认 100' },
            shard: {
              type: 'number',
              description: '指定分片序号 0-9，不传则查询全部分片',
            },
          },
          required: ['wxid_or_path'],
        },
      },
      {
        name: 'wechat_get_db_schema',
        description: '获取数据库表结构，了解字段名和类型，便于编写自定义 SQL。',
        inputSchema: {
          type: 'object',
          properties: {
            wxid_or_path: { type: 'string', description: '账户 wxid 或完整路径' },
            db_type: {
              type: 'string',
              enum: ['contact', 'message'],
              description: "数据库类型：'contact'=联系人库, 'message'=消息分片",
            },
            shard: {
              type: 'number',
              description: '消息分片序号（0-9），仅 db_type=message 时有效，默认 0',
            },
          },
          required: ['wxid_or_path', 'db_type'],
        },
      },
      {
        name: 'wechat_execute_sql',
        description:
          '在微信数据库上执行自定义 SQL 查询（只读，仅允许 SELECT/WITH/PRAGMA）。' +
          '建议先用 wechat_get_db_schema 了解表结构。',
        inputSchema: {
          type: 'object',
          properties: {
            wxid_or_path: { type: 'string', description: '账户 wxid 或完整路径' },
            db_type: {
              type: 'string',
              enum: ['contact', 'message'],
              description: "数据库类型：'contact'=联系人库, 'message'=消息分片",
            },
            shard: {
              type: 'number',
              description: '消息分片序号（0-9），仅 db_type=message 时有效，默认 0',
            },
            sql: {
              type: 'string',
              description: '要执行的 SQL（只允许 SELECT/WITH/PRAGMA）',
            },
          },
          required: ['wxid_or_path', 'db_type', 'sql'],
        },
      },
    ],
  }
})

// ---- 工具调用处理 ----

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'wechat_set_key': {
        const params = SetKeySchema.parse(args)
        currentCipherConfig = {
          key: params.key,
          pageSize: params.page_size ?? 4096,
          kdfIter: params.kdf_iter ?? 64000,
          hmacAlgo: params.hmac_algo ?? 'HMAC_SHA1',
          kdfAlgo: params.kdf_algo ?? 'PBKDF2_HMAC_SHA1',
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: '密钥已设置成功。现在可以使用其他工具查询微信数据库了。',
                config: {
                  keyPreview: params.key.startsWith('hex:')
                    ? `hex:${params.key.slice(4, 10)}...`
                    : `${params.key.slice(0, 4)}...`,
                  pageSize: currentCipherConfig.pageSize,
                  kdfIter: currentCipherConfig.kdfIter,
                },
              }),
            },
          ],
        }
      }

      case 'wechat_list_accounts': {
        ListAccountsSchema.parse(args)
        const accounts = listWeChatAccounts()
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                accounts,
                total: accounts.length,
                tip:
                  accounts.length === 0
                    ? '未找到微信账户。请确认：1) 已在该 Mac 上登录过微信 4.x; 2) 当前用户有权限读取 ~/Library/Containers/com.tencent.xinWeChat/'
                    : '使用 wxid 作为后续工具的 wxid_or_path 参数',
              }),
            },
          ],
        }
      }

      case 'wechat_list_sessions': {
        const params = ListSessionsSchema.parse(args)
        const paths = getAccountPaths(params.wxid_or_path)

        // 会话列表通常在 Session.db 或 Contact 数据库中
        // 尝试多个可能的位置
        const sessionDbCandidates = [
          paths.contactDb,
          `${paths.accountPath}/Session/Session.db`,
          `${paths.accountPath}/session.db`,
        ]

        let sessions: unknown[] = []
        let foundDb = ''

        for (const dbPath of sessionDbCandidates) {
          if (!existsSync(dbPath)) continue
          try {
            const result = withDb(dbPath, (db) =>
              querySessions(db, { limit: params.limit, offset: params.offset })
            )
            if (result.length > 0) {
              sessions = result
              foundDb = dbPath
              break
            }
          } catch {
            continue
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sessions,
                total: sessions.length,
                source: foundDb || '未找到会话数据库',
                tip: '使用 strUsrName 作为 wechat_query_messages 的 talker 参数',
              }),
            },
          ],
        }
      }

      case 'wechat_list_contacts': {
        const params = ListContactsSchema.parse(args)
        const paths = getAccountPaths(params.wxid_or_path)

        if (!existsSync(paths.contactDb)) {
          throw new Error(`联系人数据库不存在: ${paths.contactDb}`)
        }

        const contacts = withDb(paths.contactDb, (db) =>
          queryContacts(db, {
            search: params.search,
            limit: params.limit,
            offset: params.offset,
          })
        )

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                contacts,
                total: contacts.length,
                tip: '使用 userName 作为 wechat_query_messages 的 talker 参数',
              }),
            },
          ],
        }
      }

      case 'wechat_query_messages': {
        const params = QueryMessagesSchema.parse(args)
        const paths = getAccountPaths(params.wxid_or_path)
        const config = getCipherConfig()

        const queryOptions = {
          talker: params.talker,
          keyword: params.keyword,
          startTime: params.start_time,
          endTime: params.end_time,
          isSender: params.is_sender,
          limit: params.limit ?? 100,
        }

        let messages: unknown[]

        if (params.shard !== undefined) {
          // 查询指定分片
          const shardPath = `${paths.messageDir}/msg_${params.shard}.db`
          if (!existsSync(shardPath)) {
            throw new Error(`消息分片不存在: ${shardPath}`)
          }
          messages = withDb(shardPath, (db) =>
            queryMessagesFromShard(db, shardPath, queryOptions)
          )
        } else {
          // 查询所有分片
          messages = queryMessagesAllShards(paths.messageShards, config, queryOptions)
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                messages,
                total: messages.length,
                note:
                  params.shard !== undefined
                    ? `来自分片 msg_${params.shard}.db`
                    : '已合并所有分片结果，按时间倒序排列',
              }),
            },
          ],
        }
      }

      case 'wechat_get_db_schema': {
        const params = GetDatabaseSchemaSchema.parse(args)
        const paths = getAccountPaths(params.wxid_or_path)

        let dbPath: string
        if (params.db_type === 'contact') {
          dbPath = paths.contactDb
        } else {
          dbPath = `${paths.messageDir}/msg_${params.shard ?? 0}.db`
        }

        if (!existsSync(dbPath)) {
          throw new Error(`数据库文件不存在: ${dbPath}`)
        }

        const schema = withDb(dbPath, getDatabaseSchema)

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                dbPath,
                dbType: params.db_type,
                schema,
                tableCount: Object.keys(schema).length,
              }),
            },
          ],
        }
      }

      case 'wechat_execute_sql': {
        const params = ExecuteSQLSchema.parse(args)
        const paths = getAccountPaths(params.wxid_or_path)

        let dbPath: string
        if (params.db_type === 'contact') {
          dbPath = paths.contactDb
        } else {
          dbPath = `${paths.messageDir}/msg_${params.shard ?? 0}.db`
        }

        if (!existsSync(dbPath)) {
          throw new Error(`数据库文件不存在: ${dbPath}`)
        }

        const result = withDb(dbPath, (db) => executeCustomSQL(db, params.sql))

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                dbPath,
                sql: params.sql,
                columns: result.columns,
                rows: result.rows,
                rowCount: result.rowCount,
              }),
            },
          ],
        }
      }

      default:
        throw new Error(`未知工具: ${name}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
      isError: true,
    }
  }
})

// ============================
// 启动服务器
// ============================

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('ChatLab WeChat DB MCP Server 已启动\n')

  if (process.env.WECHAT_KEY) {
    process.stderr.write('已从环境变量读取密钥配置\n')
    // 触发配置加载（无需显式调用）
    try {
      getCipherConfig()
    } catch {
      // 忽略
    }
  } else {
    process.stderr.write('提示：未设置 WECHAT_KEY 环境变量，请通过 wechat_set_key 工具设置密钥\n')
  }
}

main().catch((err) => {
  process.stderr.write(`启动失败: ${err}\n`)
  process.exit(1)
})
