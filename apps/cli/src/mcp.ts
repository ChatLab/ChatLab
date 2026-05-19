/**
 * ChatLab MCP Server
 *
 * 通过 stdio 传输协议与 AI 代理（Claude Desktop、Cursor 等）通信。
 * 注册 @openchatlab/tools 中的工具为 MCP tools，
 * 会话列表作为 MCP resources 暴露。
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { loadConfig } from '@openchatlab/config'
import {
  NodePathProvider,
  DatabaseManager,
  hasPendingElectronDataWarning,
  verifyCliDataPath,
} from '@openchatlab/node-runtime'
import { getSessionMeta, getSessionOverview, getDatabaseSchema } from '@openchatlab/core'
import { MCP_TOOL_REGISTRY, CoreDataProvider } from '@openchatlab/tools'
import type { SessionListContext } from '@openchatlab/tools/src/definitions/sessions'
import { getVersion } from './version'

const MCP_TOOL_PREFIX = 'chatlab_'

let dbManager: DatabaseManager

function initMcpRuntime() {
  const config = loadConfig()
  const userDataDir = config.data.user_data_dir || undefined
  const pathProvider = new NodePathProvider(userDataDir)
  pathProvider.ensureAllDirs()

  if (hasPendingElectronDataWarning() || !verifyCliDataPath(pathProvider.getDatabaseDir())) {
    console.error('[MCP] Electron desktop data detected but databases not found.')
    console.error('[MCP] Set CHATLAB_DATA_DIR or edit ~/.chatlab/config.toml to point to your data directory.')
    process.exit(1)
  }

  dbManager = new DatabaseManager(pathProvider)
  return { config, dbManager }
}

/**
 * 将简单的 JSON Schema 属性转为 Zod schema 对象
 */
function jsonSchemaToZod(
  properties: Record<string, { type: string; description?: string; default?: unknown; enum?: unknown[] }>,
  required?: string[]
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {}
  const requiredSet = new Set(required ?? [])

  for (const [key, prop] of Object.entries(properties)) {
    let zodType: z.ZodTypeAny

    switch (prop.type) {
      case 'number':
        zodType = z.number().describe(prop.description ?? '')
        break
      case 'boolean':
        zodType = z.boolean().describe(prop.description ?? '')
        break
      case 'string':
      default:
        if (prop.enum) {
          zodType = z.enum(prop.enum as [string, ...string[]]).describe(prop.description ?? '')
        } else {
          zodType = z.string().describe(prop.description ?? '')
        }
        break
    }

    if (!requiredSet.has(key)) {
      zodType = zodType.optional()
    }

    shape[key] = zodType
  }

  return shape
}

export async function startMcpServer(): Promise<void> {
  initMcpRuntime()

  const server = new McpServer({
    name: 'chatlab',
    version: getVersion(),
  })

  // --- 注册 Tools ---

  for (const tool of MCP_TOOL_REGISTRY) {
    const mcpName = `${MCP_TOOL_PREFIX}${tool.name}`

    if (tool.name === 'list_sessions') {
      const zodShape = jsonSchemaToZod(tool.inputSchema.properties, tool.inputSchema.required)

      server.tool(mcpName, tool.description, zodShape, async (params) => {
        const context: SessionListContext = {
          db: null as any,
          sessionId: '',
          listSessionIds: () => dbManager.listSessionIds(),
          openDb: (id) => dbManager.open(id),
        }
        const result = await tool.handler(params as Record<string, unknown>, context)
        return { content: [{ type: 'text' as const, text: result.content }] }
      })
      continue
    }

    const sessionsToolMcpName = `${MCP_TOOL_PREFIX}list_sessions`
    const zodShape = {
      session_id: z.string().describe(`Session ID (use ${sessionsToolMcpName} to get available sessions)`),
      ...jsonSchemaToZod(tool.inputSchema.properties, tool.inputSchema.required),
    }

    server.tool(mcpName, tool.description, zodShape, async (params) => {
      const sessionId = params.session_id as string
      const db = dbManager.open(sessionId)
      if (!db) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Session ${sessionId} not found` }) }],
          isError: true,
        }
      }

      const toolParams = { ...params } as Record<string, unknown>
      delete toolParams.session_id

      const result = await tool.handler(toolParams, { db, sessionId, dataProvider: new CoreDataProvider(db) })
      return { content: [{ type: 'text' as const, text: result.content }] }
    })
  }

  // --- 注册 Resources ---

  server.resource('sessions-list', 'chatlab://sessions', { description: '所有已导入的聊天会话列表' }, async () => {
    const sessionIds = dbManager.listSessionIds()
    const sessions = sessionIds
      .map((id) => {
        const db = dbManager.open(id)
        if (!db) return null
        const meta = getSessionMeta(db)
        if (!meta) return null
        return { id, name: meta.name, platform: meta.platform, type: meta.type }
      })
      .filter(Boolean)

    return {
      contents: [
        {
          uri: 'chatlab://sessions',
          text: JSON.stringify(sessions, null, 2),
          mimeType: 'application/json',
        },
      ],
    }
  })

  server.resource(
    'session-meta',
    new ResourceTemplate('chatlab://sessions/{sessionId}/meta', { list: undefined }),
    { description: '会话元信息（名称、平台、消息数等）' },
    async (uri, params) => {
      const sessionId = params.sessionId as string
      const db = dbManager.open(sessionId)
      if (!db) {
        return { contents: [{ uri: uri.href, text: '{"error": "Session not found"}', mimeType: 'application/json' }] }
      }

      const meta = getSessionMeta(db)
      const overview = getSessionOverview(db)

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify({ ...meta, ...overview }, null, 2),
            mimeType: 'application/json',
          },
        ],
      }
    }
  )

  server.resource(
    'session-schema',
    new ResourceTemplate('chatlab://sessions/{sessionId}/schema', { list: undefined }),
    { description: '会话数据库的表结构' },
    async (uri, params) => {
      const sessionId = params.sessionId as string
      const db = dbManager.open(sessionId)
      if (!db) {
        return { contents: [{ uri: uri.href, text: '{"error": "Session not found"}', mimeType: 'application/json' }] }
      }

      const schema = getDatabaseSchema(db)

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(schema, null, 2),
            mimeType: 'application/json',
          },
        ],
      }
    }
  )

  // --- 启动 stdio 传输 ---
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
