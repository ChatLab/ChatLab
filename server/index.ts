import express from 'express'
import cors from 'cors'
import chatRoutes from './routes/chat'
import importRoutes, { incrementalRouter } from './routes/import'
import analysisRoutes from './routes/analysis'
import memberRoutes from './routes/members'
import messageRoutes from './routes/messages'
import { sessionNlpRouter, globalNlpRouter } from './routes/nlp'
import llmRoutes from './routes/llm'

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
