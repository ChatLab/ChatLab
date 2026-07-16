import type { FastifyInstance } from 'fastify'
import type { AiRouteContext } from '../../context/ai'
import type { RuntimeRouteContext } from '../../context/runtime'
import type { StorageRouteContext } from '../../context/storage'
import { registerAiAgentStreamRoutes } from './ai-agent-stream'
import { registerAiAssistantRoutes } from './ai-assistants'
import { registerAiChatRoutes } from './ai-chats'
import { registerAiLlmStreamRoutes } from './ai-llm-stream'
import { registerAiLlmRoutes } from './ai-llm'
import { registerAiLogRoutes } from './ai-logs'
import { registerSemanticIndexRoutes } from './ai-semantic-index'
import { registerAiSkillRoutes } from './ai-skills'
import { registerAiSummaryRoutes } from './ai-summaries'
import { registerAiToolRoutes } from './ai-tools'

export type AiRoutesContext = AiRouteContext &
  Pick<RuntimeRouteContext, 'dbManager' | 'sessionAdapter' | 'pathProvider'> &
  Pick<StorageRouteContext, 'showInFolder'>

export interface AiRouteOptions {
  /** When true, core AI routes throw on missing dependencies instead of silently skipping. */
  requireAi?: boolean
}

const REQUIRED_AI_DEPENDENCIES = [
  'aiDataDir',
  'aiChatManager',
  'assistantManager',
  'skillManagerCore',
  'llmConfigStore',
  'customProviderStore',
  'customModelStore',
  'runAgentStream',
] as const satisfies ReadonlyArray<keyof AiRouteContext>

function assertRequiredAiContext(ctx: AiRouteContext): void {
  const missing = REQUIRED_AI_DEPENDENCIES.filter((key) => !ctx[key])
  if (missing.length > 0) {
    throw new Error(`[http-routes] requireAi is set but missing AI dependencies: ${missing.join(', ')}`)
  }
}

/** Register all AI-related Web routes while preserving optional-feature behavior. */
export function registerAiRoutes(server: FastifyInstance, ctx: AiRoutesContext, options?: AiRouteOptions): void {
  if (options?.requireAi) assertRequiredAiContext(ctx)

  registerAiAssistantRoutes(server, ctx)
  registerAiSkillRoutes(server, ctx)
  registerAiLlmRoutes(server, ctx)
  registerAiLlmStreamRoutes(server, ctx)
  registerAiAgentStreamRoutes(server, ctx)
  registerAiToolRoutes(server, ctx)
  registerAiChatRoutes(server, ctx)
  registerAiSummaryRoutes(server, ctx)
  registerAiLogRoutes(server, ctx)
  registerSemanticIndexRoutes(server, ctx)
}
