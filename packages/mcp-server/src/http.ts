/**
 * HTTP/SSE transport + REST API
 * Provides both MCP protocol over SSE and direct REST API endpoints
 */

import express from 'express'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { openDatabase, listSessions } from './db.js'
import * as queries from './queries.js'
import { formatMessagesAsText, formatMessagesAsMarkdown } from './utils/format.js'

/**
 * Start the HTTP server with SSE transport and REST API
 */
export async function startHttpServer(server: McpServer, port: number, apiKey?: string): Promise<void> {
  const app = express()
  app.use(express.json())

  // ==================== CORS ====================

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (_req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
    next()
  })

  // ==================== API Key Authentication ====================

  if (apiKey) {
    app.use((req, res, next) => {
      if (req.method === 'OPTIONS') { next(); return }
      const authHeader = req.headers.authorization
      const provided = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : (req.query.api_key as string | undefined)

      if (provided !== apiKey) {
        res.status(401).json({ error: 'Invalid or missing API key. Use Authorization: Bearer <key> header.' })
        return
      }
      next()
    })
    console.error('[ChatLab MCP] API key authentication enabled for all endpoints (SSE + REST)')
  }

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

  // Get session overview
  app.get('/api/v1/sessions/:id/overview', (req, res) => {
    const db = openDatabase(req.params.id)
    if (!db) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    const overview = queries.getSessionOverview(db)
    res.json(overview)
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

  // Export messages
  app.get('/api/v1/sessions/:id/export', (req, res) => {
    const db = openDatabase(req.params.id)
    if (!db) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const keywords = req.query.keywords
      ? String(req.query.keywords).split(',').map((k) => k.trim()).filter(Boolean)
      : []
    const limit = req.query.limit ? Number(req.query.limit) : 200
    const format = (req.query.format as string) || 'text'
    const senderId = req.query.sender_id ? Number(req.query.sender_id) : undefined

    const result = keywords.length > 0
      ? queries.searchMessages(db, keywords, { senderId, limit })
      : queries.getRecentMessages(db, { limit })

    switch (format) {
      case 'json':
        res.json(result)
        break
      case 'markdown':
        res.type('text/markdown').send(formatMessagesAsMarkdown(result.messages))
        break
      default:
        res.type('text/plain').send(formatMessagesAsText(result.messages))
    }
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

  // Word frequency
  app.get('/api/v1/sessions/:id/word-frequency', (req, res) => {
    const db = openDatabase(req.params.id)
    if (!db) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const topN = req.query.top_n ? Number(req.query.top_n) : 50
    const minCount = req.query.min_count ? Number(req.query.min_count) : 3

    const result = queries.getWordFrequency(db, { topN, minCount })
    res.json(result)
  })

  // Get messages by date range
  app.get('/api/v1/sessions/:id/messages/range', (req, res) => {
    const db = openDatabase(req.params.id)
    if (!db) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const startDate = req.query.start as string
    const endDate = req.query.end as string
    if (!startDate || !endDate) {
      res.status(400).json({ error: 'Missing required query params: start, end (YYYY-MM-DD)' })
      return
    }

    const limit = req.query.limit ? Number(req.query.limit) : 200
    const senderId = req.query.sender_id ? Number(req.query.sender_id) : undefined

    const result = queries.getDateRangeMessages(db, startDate, endDate, { senderId, limit })
    res.json(result)
  })

  // Get member profile
  app.get('/api/v1/sessions/:id/members/:memberId/profile', (req, res) => {
    const db = openDatabase(req.params.id)
    if (!db) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const memberId = Number(req.params.memberId)
    const profile = queries.getMemberProfile(db, memberId)
    if (!profile) {
      res.status(404).json({ error: 'Member not found' })
      return
    }
    res.json(profile)
  })

  // Get interaction frequency between member pairs
  app.get('/api/v1/sessions/:id/interaction-frequency', (req, res) => {
    const db = openDatabase(req.params.id)
    if (!db) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const topN = req.query.top_n ? Number(req.query.top_n) : 10
    const pairs = queries.getInteractionFrequency(db, topN)
    res.json({ pairs, total: pairs.length })
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

  app.listen(port, '127.0.0.1', () => {
    console.error(`[ChatLab MCP] HTTP server listening on http://127.0.0.1:${port}`)
    console.error(`[ChatLab MCP] SSE endpoint: http://127.0.0.1:${port}/sse`)
    console.error(`[ChatLab MCP] REST API: http://127.0.0.1:${port}/api/v1/`)
  })
}
