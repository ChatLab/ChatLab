/**
 * HTTP/SSE transport + REST API
 * Provides both MCP protocol over SSE and direct REST API endpoints
 */

import express from 'express'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { openDatabase, listSessions } from './db.js'
import * as queries from './queries.js'

/**
 * Start the HTTP server with SSE transport and REST API
 */
export async function startHttpServer(server: McpServer, port: number): Promise<void> {
  const app = express()
  app.use(express.json())

  // ==================== MCP SSE Transport ====================

  // Store active transports
  const transports = new Map<string, SSEServerTransport>()

  app.get('/sse', async (req, res) => {
    const transport = new SSEServerTransport('/messages', res)
    const sessionId = transport.sessionId
    transports.set(sessionId, transport)

    res.on('close', () => {
      transports.delete(sessionId)
    })

    await server.connect(transport)
  })

  app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId as string
    const transport = transports.get(sessionId)

    if (!transport) {
      res.status(404).json({ error: 'SSE session not found' })
      return
    }

    await transport.handlePostMessage(req, res)
  })

  // ==================== REST API ====================

  // List all sessions
  app.get('/api/v1/sessions', (_req, res) => {
    const sessions = listSessions()
    res.json({ sessions })
  })

  // Get session members
  app.get('/api/v1/sessions/:id/members', (req, res) => {
    const db = openDatabase(req.params.id)
    if (!db) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    const members = queries.getMembers(db)
    res.json({ members })
  })

  // Search messages
  app.get('/api/v1/sessions/:id/messages', (req, res) => {
    const db = openDatabase(req.params.id)
    if (!db) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const keywords = req.query.keywords
      ? String(req.query.keywords).split(',').map((k) => k.trim()).filter(Boolean)
      : []
    const limit = req.query.limit ? Number(req.query.limit) : 30
    const senderId = req.query.sender_id ? Number(req.query.sender_id) : undefined

    const result = queries.searchMessages(db, keywords, { senderId, limit })
    res.json(result)
  })

  // Get recent messages
  app.get('/api/v1/sessions/:id/recent', (req, res) => {
    const db = openDatabase(req.params.id)
    if (!db) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const limit = req.query.limit ? Number(req.query.limit) : 50
    const result = queries.getRecentMessages(db, { limit })
    res.json(result)
  })

  // Get member stats
  app.get('/api/v1/sessions/:id/member-stats', (req, res) => {
    const db = openDatabase(req.params.id)
    if (!db) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const topN = req.query.top_n ? Number(req.query.top_n) : 10
    const result = queries.getMemberActivity(db)
    res.json({ members: result.slice(0, topN), total: result.length })
  })

  // Get time stats
  app.get('/api/v1/sessions/:id/stats/:type', (req, res) => {
    const db = openDatabase(req.params.id)
    if (!db) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const { type } = req.params
    let data: unknown

    switch (type) {
      case 'hourly':
        data = queries.getHourlyActivity(db)
        break
      case 'daily':
        data = queries.getDailyActivity(db)
        break
      case 'weekday':
        data = queries.getWeekdayActivity(db)
        break
      case 'monthly':
        data = queries.getMonthlyActivity(db)
        break
      default:
        res.status(400).json({ error: `Unknown stats type: ${type}. Valid: hourly, daily, weekday, monthly` })
        return
    }

    res.json({ type, data })
  })

  // Execute SQL
  app.post('/api/v1/sessions/:id/sql', (req, res) => {
    const db = openDatabase(req.params.id)
    if (!db) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const { sql } = req.body
    if (!sql || typeof sql !== 'string') {
      res.status(400).json({ error: 'Missing "sql" in request body' })
      return
    }

    try {
      const result = queries.executeRawSQL(db, sql)
      res.json(result)
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  // Get schema
  app.get('/api/v1/sessions/:id/schema', (req, res) => {
    const db = openDatabase(req.params.id)
    if (!db) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const schema = queries.getSchema(db)
    res.json({ schema })
  })

  // ==================== Start Server ====================

  app.listen(port, () => {
    console.error(`[ChatLab MCP] HTTP server listening on http://localhost:${port}`)
    console.error(`[ChatLab MCP] SSE endpoint: http://localhost:${port}/sse`)
    console.error(`[ChatLab MCP] REST API: http://localhost:${port}/api/v1/`)
  })
}
