export type {
  HttpRouteContext,
  AutomationRouteContext,
  AutomationDataSourceLike,
  AgentStreamRequest,
  AiToolExecuteRequest,
  AiToolExecuteResult,
} from './context'
export { registerSharedRoutes } from './register'
export type { SharedRouteOptions } from './register'
export { setAuthToken, setRequireAuth, authHook } from './auth'
export {
  ApiError,
  ApiErrorCode,
  unauthorized,
  sessionNotFound,
  invalidFormat,
  invalidPayload,
  sqlReadonlyViolation,
  sqlExecutionError,
  exportTooLarge,
  serverError,
  importInProgress,
  idempotencyConflict,
  idempotencyPending,
  importFailed,
  dataDirIncompatible,
  apiErrorFromUnknown,
  successResponse,
  errorResponse,
} from './errors'
export { parseTimeFilter } from './helpers'
export { createApiServer, configureApiErrorHandler, DEFAULT_JSON_BODY_LIMIT } from './server'
export type { ApiServerOptions } from './server'
export {
  buildImportIdempotencyCacheKey,
  createJsonPushImportHandler,
  type ImportSuccessResponse,
  type JsonPushImportHandler,
  type JsonPushImportHandlerOptions,
  type JsonPushImportHttpResult,
  type JsonPushImportRequest,
} from './import/json-push-handler'
export { buildAnalyticsCacheKey, withAnalyticsCache } from './analytics-cache'
export { executeRegistryTool } from './ai/tool-executor'
export type { AiToolExecutionDeps } from './ai/tool-executor'
export { createAuthProfileLlmConfigStore } from './ai/auth-profile-llm-config-store'
export type { AuthProfileLlmConfigStoreDeps } from './ai/auth-profile-llm-config-store'

// Individual route registration for granular testing or selective registration
export { registerSystemRoutes } from './routes/system'
export type { SystemRouteContext } from './routes/system'
export { registerRestSessionRoutes } from './routes/sessions'
export { createDatabaseRestSessionProvider } from './routes/rest-session-provider'
export type {
  RestMessageQuery,
  RestMessagePage,
  RestSessionDetail,
  RestSessionExportData,
  RestSessionOverview,
  RestSessionProvider,
  RestSessionSummary,
} from './routes/rest-session-provider'
export { registerSessionRoutes } from './routes/web/sessions'
export { registerMemberRoutes } from './routes/web/members'
export { registerPreferencesRoutes } from './routes/web/preferences'
export { registerAnalyticsRoutes } from './routes/web/analytics'
export { registerSqlRoutes } from './routes/web/sql'
export { registerSessionIndexRoutes } from './routes/web/session-index'
export { registerExportRoutes } from './routes/web/export'
export { registerNlpRoutes } from './routes/web/nlp'
export { registerAiAssistantRoutes } from './routes/web/ai-assistants'
export { registerAiSkillRoutes } from './routes/web/ai-skills'
export { registerAiLlmRoutes } from './routes/web/ai-llm'
export { registerAiChatRoutes } from './routes/web/ai-chats'
export { registerAiSummaryRoutes } from './routes/web/ai-summaries'
export { registerAiLlmStreamRoutes } from './routes/web/ai-llm-stream'
export { registerAiAgentStreamRoutes } from './routes/web/ai-agent-stream'
export { registerAiToolRoutes } from './routes/web/ai-tools'
export { registerTelemetryRoutes } from './routes/web/telemetry'
export { registerAutomationRoutes } from './routes/web/automation'
export { registerGlobalInsightRoutes } from './routes/web/global-insight'
