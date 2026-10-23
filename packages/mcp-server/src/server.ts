/**
 * ChatLab MCP Server core
 *
 * Registers @openchatlab/tools as MCP tools and exposes session data as MCP resources.
 * Communicates with AI agents (ClaudeCode, Cursor, etc.) via stdio transport.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getSessionMeta, getSessionOverview, getDatabaseSchema } from '@openchatlab/core'
import type { DatabaseAdapter } from '@openchatlab/core'
import { MCP_TOOL_REGISTRY, CoreDataProvider, getLocalizedToolMetadata } from '@openchatlab/tools'
import type { SessionListContext } from '@openchatlab/tools/src/definitions/sessions'
import type { McpDatabaseManager, McpServerOptions } from './types'
import { jsonSchemaToZod } from './schema'
import { formatToolResultAsText } from './format'

const MCP_TOOL_PREFIX = 'chatlab_'

const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const

const FORMAT_PARAM = z.enum(['text', 'json']).optional().describe('text (default) or json')

/** Tools where JSON is a better default (raw SQL results, schema) */
const JSON_DEFAULT_TOOLS = new Set(['execute_sql', 'get_schema'])

function applyFormat(content: string, format: string | undefined, toolName: string): string {
  const effectiveFormat = format ?? (JSON_DEFAULT_TOOLS.has(toolName) ? 'json' : 'text')
  if (effectiveFormat === 'json') return content

  const textResult = formatToolResultAsText(content)
  return textResult ?? content
}

export function registerTools(server: McpServer, dbManager: McpDatabaseManager, locale?: string): void {
  for (const tool of MCP_TOOL_REGISTRY) {
    const mcpName = `${MCP_TOOL_PREFIX}${tool.name}`
    const { description, inputSchema } = getLocalizedToolMetadata(tool, locale)

    if (tool.name === 'list_sessions') {
      const zodShape = {
        ...jsonSchemaToZod(inputSchema.properties, inputSchema.required),
        format: FORMAT_PARAM,
      }

      server.registerTool(
        mcpName,
        { description, inputSchema: zodShape, annotations: READ_ONLY_TOOL_ANNOTATIONS },
        async (params) => {
          const format = params.format as string | undefined
          // The shared list handler opens multiple databases; close every connection
          // after it returns, including when a query throws.
          const openedDbs: DatabaseAdapter[] = []
          try {
            const context: SessionListContext = {
              db: null as any,
              sessionId: '',
              listSessionIds: () => dbManager.listSessionIdsMcpReadonly(),
              openDb: (id) => {
                const db = dbManager.openMcpReadonly(id)
                if (db) openedDbs.push(db)
                return db
              },
            }
            const toolParams = { ...params } as Record<string, unknown>
            delete toolParams.format
            const result = await tool.handler(toolParams, context)
            const text = applyFormat(result.content, format, tool.name)
            return { content: [{ type: 'text' as const, text }] }
          } finally {
            for (const db of openedDbs) db.close()
          }
        }
      )
      continue
    }

    const zodShape = {
      session_id: z.string().describe('Session ID'),
      ...jsonSchemaToZod(inputSchema.properties, inputSchema.required),
      format: FORMAT_PARAM,
    }

    server.registerTool(
      mcpName,
      { description, inputSchema: zodShape, annotations: READ_ONLY_TOOL_ANNOTATIONS },
      async (params) => {
        const sessionId = params.session_id as string
        const format = params.format as string | undefined
        const db = dbManager.openMcpReadonly(sessionId)
        if (!db) {
          return {
            content: [{ type: 'text' as const, text: `Session not found: ${sessionId}` }],
            isError: true,
          }
        }

        try {
          const toolParams = { ...params } as Record<string, unknown>
          delete toolParams.session_id
          delete toolParams.format

          const result = await tool.handler(toolParams, { db, sessionId, dataProvider: new CoreDataProvider(db) })
          const text = applyFormat(result.content, format, tool.name)
          return { content: [{ type: 'text' as const, text }] }
        } finally {
          db.close()
        }
      }
    )
  }
}

function registerResources(server: McpServer, dbManager: McpDatabaseManager): void {
  server.resource('sessions-list', 'chatlab://sessions', { description: '所有已导入的聊天会话列表' }, async () => {
    const sessionIds = dbManager.listSessionIdsMcpReadonly()
    const sessions = sessionIds
      .map((id) => {
        const db = dbManager.openMcpReadonly(id)
        if (!db) return null
        try {
          const meta = getSessionMeta(db)
          if (!meta) return null
          return { id, name: meta.name, platform: meta.platform, type: meta.type }
        } finally {
          db.close()
        }
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
      const db = dbManager.openMcpReadonly(sessionId)
      if (!db) {
        return { contents: [{ uri: uri.href, text: '{"error": "Session not found"}', mimeType: 'application/json' }] }
      }

      try {
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
      } finally {
        db.close()
      }
    }
  )

  server.resource(
    'session-schema',
    new ResourceTemplate('chatlab://sessions/{sessionId}/schema', { list: undefined }),
    { description: '会话数据库的表结构' },
    async (uri, params) => {
      const sessionId = params.sessionId as string
      const db = dbManager.openMcpReadonly(sessionId)
      if (!db) {
        return { contents: [{ uri: uri.href, text: '{"error": "Session not found"}', mimeType: 'application/json' }] }
      }

      try {
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
      } finally {
        db.close()
      }
    }
  )
}

export async function startMcpServer(options: McpServerOptions): Promise<void> {
  const { version, name = 'chatlab', dbManager, locale } = options

  const server = new McpServer({ name, version })

  registerTools(server, dbManager, locale)
  registerResources(server, dbManager)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
