/**
 * Aggregate route registration — one call to register all shared routes.
 *
 * CLI Server and Electron Internal Server call this instead of
 * importing individual route modules.
 */

import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from './context'
import { PreferencesManager } from '@openchatlab/node-runtime'
import { registerSystemRoutes } from './routes/rest/system'
import { registerRestSessionRoutes } from './routes/rest/sessions'
import { createDatabaseRestSessionProvider } from './routes/rest/session-provider'
import { registerImportRoutes } from './routes/rest/imports'
import { registerSessionRoutes } from './routes/web/sessions'
import { registerMemberRoutes } from './routes/web/members'
import { registerContactsRoutes } from './routes/web/contacts'
import { registerPeopleRelationshipsRoutes } from './routes/web/people-relationships'
import { registerGlobalInsightRoutes } from './routes/web/global-insight'
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
import { registerAiToolRoutes } from './routes/web/ai-tools'
import { registerAiChatRoutes } from './routes/web/ai-chats'
import { registerAiSummaryRoutes } from './routes/web/ai-summaries'
import { registerAiLogRoutes } from './routes/web/ai-logs'
import { registerSemanticIndexRoutes } from './routes/web/ai-semantic-index'
import { registerMergeRoutes } from './routes/web/merge'
import { registerCacheRoutes } from './routes/web/cache'
import { registerTelemetryRoutes } from './routes/web/telemetry'
import { registerLogRoutes } from './routes/web/logs'

export interface SharedRouteOptions {
  /** When true, AI routes will throw on missing dependencies instead of silently skipping */
  requireAi?: boolean
}

export function registerSharedRoutes(
  server: FastifyInstance,
  ctx: HttpRouteContext,
  options?: SharedRouteOptions
): void {
  // Ensure all routes share one PreferencesManager instance to avoid stale-cache
  // overwrites between the session owner routes and the preferences routes.
  const resolvedCtx: HttpRouteContext = ctx.preferencesManager
    ? ctx
    : { ...ctx, preferencesManager: new PreferencesManager(ctx.pathProvider.getSystemDir()) }

  // REST API (/api/v1/*)
  const restSessionProvider =
    resolvedCtx.restSessionProvider ?? createDatabaseRestSessionProvider(resolvedCtx.dbManager)
  registerSystemRoutes(server, {
    getVersion: resolvedCtx.getVersion,
    countSessions: restSessionProvider.countSessions,
  })
  registerRestSessionRoutes(server, restSessionProvider)
  registerImportRoutes(server, resolvedCtx)

  // Web UI API (/_web/*)
  registerSessionRoutes(server, resolvedCtx)
  registerMemberRoutes(server, resolvedCtx)
  registerContactsRoutes(server, resolvedCtx)
  registerPeopleRelationshipsRoutes(server, resolvedCtx)
  registerGlobalInsightRoutes(server, resolvedCtx)
  registerPreferencesRoutes(server, resolvedCtx)
  registerAnalyticsRoutes(server, resolvedCtx)
  registerSqlRoutes(server, resolvedCtx)
  registerSessionIndexRoutes(server, resolvedCtx)
  registerExportRoutes(server, resolvedCtx)
  registerNlpRoutes(server, resolvedCtx)

  if (options?.requireAi) {
    const missing: string[] = []
    if (!resolvedCtx.aiDataDir) missing.push('aiDataDir')
    if (!resolvedCtx.aiChatManager) missing.push('aiChatManager')
    if (!resolvedCtx.assistantManager) missing.push('assistantManager')
    if (!resolvedCtx.skillManagerCore) missing.push('skillManagerCore')
    if (!resolvedCtx.llmConfigStore) missing.push('llmConfigStore')
    if (!resolvedCtx.customProviderStore) missing.push('customProviderStore')
    if (!resolvedCtx.customModelStore) missing.push('customModelStore')
    if (!resolvedCtx.runAgentStream) missing.push('runAgentStream')
    if (missing.length > 0) {
      throw new Error(`[http-routes] requireAi is set but missing AI dependencies: ${missing.join(', ')}`)
    }
  }

  registerAiAssistantRoutes(server, resolvedCtx)
  registerAiSkillRoutes(server, resolvedCtx)
  registerAiLlmRoutes(server, resolvedCtx)
  registerAiLlmStreamRoutes(server, resolvedCtx)
  registerAiAgentStreamRoutes(server, resolvedCtx)
  registerAiToolRoutes(server, resolvedCtx)
  registerAiChatRoutes(server, resolvedCtx)
  registerAiSummaryRoutes(server, resolvedCtx)
  registerAiLogRoutes(server, resolvedCtx)
  registerSemanticIndexRoutes(server, resolvedCtx)

  // Merge routes (graceful skip when mergeSessionCache is absent)
  registerMergeRoutes(server, resolvedCtx)

  // Cache/storage routes
  registerCacheRoutes(server, resolvedCtx)

  // Telemetry routes
  registerTelemetryRoutes(server, resolvedCtx)

  // Front-end log report + open logs dir
  registerLogRoutes(server, resolvedCtx)
}
