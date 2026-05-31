export type { HttpRouteContext } from './context'
export { registerSharedRoutes } from './register'
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
  successResponse,
  errorResponse,
} from './errors'
export { parseTimeFilter } from './helpers'

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
