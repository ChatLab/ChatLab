import type { FastifyInstance } from 'fastify'
import { PreferencesManager } from '@openchatlab/node-runtime'
import type { AiRouteContext } from '../../context/ai'
import type { MergeRouteContext } from '../../context/merge'
import type { RuntimeRouteContext } from '../../context/runtime'
import type { ServiceRouteContext } from '../../context/services'
import type { StorageRouteContext } from '../../context/storage'
import { registerAiRoutes, type AiRouteOptions } from './register-ai'
import { registerAnalyticsRoutes } from './analytics'
import { registerCacheRoutes } from './cache'
import { registerContactsRoutes } from './contacts'
import { registerExportRoutes } from './export'
import { registerGlobalInsightRoutes } from './global-insight'
import { registerLogRoutes } from './logs'
import { registerMemberRoutes } from './members'
import { registerMergeRoutes } from './merge'
import { registerNlpRoutes } from './nlp'
import { registerPeopleRelationshipsRoutes } from './people-relationships'
import { registerPreferencesRoutes } from './preferences'
import { registerSessionIndexRoutes } from './session-index'
import { registerSessionRoutes } from './sessions'
import { registerSqlRoutes } from './sql'
import { registerTelemetryRoutes } from './telemetry'

export type WebRoutesContext = RuntimeRouteContext &
  ServiceRouteContext &
  MergeRouteContext &
  AiRouteContext &
  StorageRouteContext

export type WebRouteOptions = AiRouteOptions

/** Register the internal Web API under /_web, excluding lifecycle-owned automation routes. */
export function registerWebRoutes(server: FastifyInstance, ctx: WebRoutesContext, options?: WebRouteOptions): void {
  // Sessions and preferences must share one manager to avoid stale-cache overwrites.
  const resolvedCtx: WebRoutesContext = ctx.preferencesManager
    ? ctx
    : { ...ctx, preferencesManager: new PreferencesManager(ctx.pathProvider.getSystemDir()) }

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
  registerAiRoutes(server, resolvedCtx, options)
  registerMergeRoutes(server, resolvedCtx)
  registerCacheRoutes(server, resolvedCtx)
  registerTelemetryRoutes(server, resolvedCtx)
  registerLogRoutes(server)
}
