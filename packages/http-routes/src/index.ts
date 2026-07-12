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
  invalidPayload,
  sqlReadonlyViolation,
  sqlExecutionError,
  exportTooLarge,
  serverError,
  dataDirIncompatible,
  apiErrorFromUnknown,
  successResponse,
  errorResponse,
} from './errors'
export { parseTimeFilter } from './helpers'
export { buildAnalyticsCacheKey, withAnalyticsCache } from './analytics-cache'

// Individual route registration for granular testing or selective registration
export { registerSystemRoutes } from './routes/system'
export { registerRestSessionRoutes } from './routes/sessions'
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
