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
export { annualSummaryNodePlugin } from './plugins/builtin/annual-summary'
export { registerNodePlugins } from './plugins/node'
export type { NodePluginContext, NodePluginDescriptor } from './plugins/node'
export { executeRegistryTool } from './ai/tool-executor'
export type { AiToolExecutionDeps } from './ai/tool-executor'
export { registerAutomationRoutes } from './routes/web/automation'
