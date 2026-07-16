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
export { executeRegistryTool } from './ai/tool-executor'
export type { AiToolExecutionDeps } from './ai/tool-executor'
export { registerAutomationRoutes } from './routes/web/automation'
