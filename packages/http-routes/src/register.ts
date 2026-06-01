/**
 * Aggregate route registration — one call to register all shared routes.
 *
 * CLI Server and Electron Internal Server call this instead of
 * importing individual route modules.
 */

import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from './context'
import { registerSystemRoutes } from './routes/system'
import { registerRestSessionRoutes } from './routes/sessions'
import { registerSessionRoutes } from './routes/web/sessions'
import { registerMemberRoutes } from './routes/web/members'
import { registerPreferencesRoutes } from './routes/web/preferences'
import { registerAnalyticsRoutes } from './routes/web/analytics'
import { registerSqlRoutes } from './routes/web/sql'
import { registerSessionIndexRoutes } from './routes/web/session-index'
import { registerExportRoutes } from './routes/web/export'
import { registerNlpRoutes } from './routes/web/nlp'
import { registerAiAssistantRoutes } from './routes/web/ai-assistants'
import { registerAiSkillRoutes } from './routes/web/ai-skills'
import { registerAiLlmRoutes } from './routes/web/ai-llm'
import { registerAiLlmStreamRoutes } from './routes/web/ai-llm-stream'
import { registerAiAgentStreamRoutes } from './routes/web/ai-agent-stream'
import { registerAiFilterRoutes } from './routes/web/ai-filter'
import { registerAiToolRoutes } from './routes/web/ai-tools'
import { registerAiConversationRoutes } from './routes/web/ai-conversations'
import { registerAiSummaryRoutes } from './routes/web/ai-summaries'
import { registerMergeRoutes } from './routes/web/merge'
import { registerCacheRoutes } from './routes/web/cache'

export interface SharedRouteOptions {
  /** When true, AI routes will throw on missing dependencies instead of silently skipping */
  requireAi?: boolean
}

export function registerSharedRoutes(
  server: FastifyInstance,
  ctx: HttpRouteContext,
  options?: SharedRouteOptions
): void {
  // REST API (/api/v1/*)
  registerSystemRoutes(server, ctx)
  registerRestSessionRoutes(server, ctx)

  // Web UI API (/_web/*)
  registerSessionRoutes(server, ctx)
  registerMemberRoutes(server, ctx)
  registerPreferencesRoutes(server, ctx)
  registerAnalyticsRoutes(server, ctx)
  registerSqlRoutes(server, ctx)
  registerSessionIndexRoutes(server, ctx)
  registerExportRoutes(server, ctx)
  registerNlpRoutes(server, ctx)

  if (options?.requireAi) {
    const missing: string[] = []
    if (!ctx.aiDataDir) missing.push('aiDataDir')
    if (!ctx.conversationManager) missing.push('conversationManager')
    if (!ctx.assistantManager) missing.push('assistantManager')
    if (!ctx.skillManagerCore) missing.push('skillManagerCore')
    if (!ctx.llmConfigStore) missing.push('llmConfigStore')
    if (!ctx.customProviderStore) missing.push('customProviderStore')
    if (!ctx.customModelStore) missing.push('customModelStore')
    if (!ctx.runAgentStream) missing.push('runAgentStream')
    if (missing.length > 0) {
      throw new Error(`[http-routes] requireAi is set but missing AI dependencies: ${missing.join(', ')}`)
    }
  }

  registerAiAssistantRoutes(server, ctx)
  registerAiSkillRoutes(server, ctx)
  registerAiLlmRoutes(server, ctx)
  registerAiLlmStreamRoutes(server, ctx)
  registerAiAgentStreamRoutes(server, ctx)
  registerAiFilterRoutes(server, ctx)
  registerAiToolRoutes(server, ctx)
  registerAiConversationRoutes(server, ctx)
  registerAiSummaryRoutes(server, ctx)

  // Merge routes (graceful skip when mergeSessionCache is absent)
  registerMergeRoutes(server, ctx)

  // Cache/storage routes
  registerCacheRoutes(server, ctx)
}
