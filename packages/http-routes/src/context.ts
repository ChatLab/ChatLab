/**
 * Shared dependency injection contract assembled by CLI Server and Electron.
 * Route modules consume narrower capability interfaces from ./context/*.
 */

import type { AiRouteContext } from './context/ai'
import type { AutomationRouteHostContext } from './context/automation'
import type { MergeRouteContext } from './context/merge'
import type { RestRouteContext } from './context/rest'
import type { RuntimeRouteContext } from './context/runtime'
import type { ServiceRouteContext } from './context/services'
import type { StorageRouteContext } from './context/storage'

export interface HttpRouteContext
  extends
    RuntimeRouteContext,
    ServiceRouteContext,
    RestRouteContext,
    MergeRouteContext,
    AiRouteContext,
    StorageRouteContext,
    AutomationRouteHostContext {}

export type { AgentStreamRequest, AiRouteContext, AiToolExecuteRequest, AiToolExecuteResult } from './context/ai'
export type { AutomationDataSourceLike, AutomationRouteContext, AutomationRouteHostContext } from './context/automation'
export type { MergeRouteContext } from './context/merge'
export type { RestRouteContext } from './context/rest'
export type { RuntimeRouteContext } from './context/runtime'
export type { ServiceRouteContext } from './context/services'
export type { StorageRouteContext } from './context/storage'
