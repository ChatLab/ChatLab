import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import express from 'express'
import cors from 'cors'
import chatRoutes from './routes/chat'
import importRoutes, { incrementalRouter } from './routes/import'
import analysisRoutes from './routes/analysis'
import memberRoutes from './routes/members'
import messageRoutes from './routes/messages'
import { sessionNlpRouter, globalNlpRouter } from './routes/nlp'
import llmRoutes from './routes/llm'
import agentRoutes from './routes/agent'
import aiConversationRoutes from './routes/ai-conversations'
import embeddingRoutes from './routes/embedding'
import cacheRoutes from './routes/cache'
import networkRoutes from './routes/network'
import sessionIndexRoutes from './routes/session-index'
import mergeRoutes from './routes/merge'
import migrationRoutes from './routes/migration'

export function createApp() {
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.use('/api/import', importRoutes)
  app.use('/api/sessions', chatRoutes)
  // Incremental import routes nested under /api/sessions/:id
  app.use('/api/sessions/:id', incrementalRouter)
  // Analysis routes: /api/sessions/:id/<analysis-endpoint>
  app.use('/api/sessions', analysisRoutes)
  // Member management routes: /api/sessions/:id/members/*
  app.use('/api/sessions', memberRoutes)
  // Message query routes: /api/sessions/:id/messages/*
  app.use('/api/sessions', messageRoutes)
  // NLP routes: /api/sessions/:id/nlp/* and /api/nlp/*
  app.use('/api/sessions', sessionNlpRouter)
  app.use('/api/nlp', globalNlpRouter)
  // LLM config routes: /api/llm/*
  app.use('/api/llm', llmRoutes)
  // Agent routes: /api/agent/*
  app.use('/api/agent', agentRoutes)
  // AI conversation routes: /api/ai-conversations/*
  app.use('/api/ai-conversations', aiConversationRoutes)
  // Embedding config routes: /api/embedding/*
  app.use('/api/embedding', embeddingRoutes)
  // Cache management routes: /api/cache/*
  app.use('/api/cache', cacheRoutes)
  // Network/proxy routes: /api/network/*
  app.use('/api/network', networkRoutes)
  // Session index routes: /api/sessions/:id/session-index/*
  app.use('/api/sessions', sessionIndexRoutes)
  // Merge routes: /api/merge/*
  app.use('/api/merge', mergeRoutes)
  // Migration routes: /api/migration/*
  app.use('/api/migration', migrationRoutes)

  // In production, serve the Vite-built client files
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const clientDir = resolve(__dirname, '../dist/client')
  if (existsSync(clientDir)) {
    app.use(express.static(clientDir))
    // SPA fallback: serve index.html for all non-API routes
    app.use((req, res, next) => {
      // Skip API routes
      if (req.path.startsWith('/api/')) return next()
      res.sendFile('index.html', { root: clientDir }, (err) => {
        if (err) next(err)
      })
    })
  }

  return app
}

const port = process.env.PORT || 3001

// Only start the server when this file is run directly (not when imported by tests)
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('server/index.ts') ||
    process.argv[1].endsWith('server/index.js'))

if (isDirectRun) {
  const app = createApp()
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`)
  })
}
