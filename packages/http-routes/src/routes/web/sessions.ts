import type { FastifyInstance } from 'fastify'
import type { AiRouteContext } from '../../context/ai'
import type { RuntimeRouteContext } from '../../context/runtime'
import type { ServiceRouteContext } from '../../context/services'
import {
  chatTopicWorkCoordinator,
  sessionService,
  ownerProfileService,
  PreferencesManager,
} from '@openchatlab/node-runtime'

type SessionRouteContext = Pick<RuntimeRouteContext, 'sessionAdapter' | 'pathProvider' | 'beforeDeleteSession'> &
  Pick<ServiceRouteContext, 'preferencesManager'> &
  Pick<AiRouteContext, 'aiChatManager'>

export function registerSessionRoutes(server: FastifyInstance, ctx: SessionRouteContext): void {
  const { sessionAdapter: adapter } = ctx
  const cacheDir = ctx.pathProvider.getCacheDir()

  // Lazy: only owner-profile routes need preferences.json access
  let preferencesInstance: PreferencesManager | null = null
  const preferences = () => {
    preferencesInstance ??= ctx.preferencesManager ?? new PreferencesManager(ctx.pathProvider.getSystemDir())
    return preferencesInstance
  }

  server.get('/_web/sessions', async () => {
    const aiChatCounts = ctx.aiChatManager?.getAIChatCountsBySession()
    const excludedSessionIds = new Set(preferences().load().ownerExcludedSessionIds)
    return sessionService.listAnalysisSessions(adapter, {
      resolveOverview: (db, sessionId) => sessionService.resolveValidatedSessionOverview(db, sessionId, cacheDir),
      enrichSession: (dto) => ({
        ...dto,
        aiConversationCount: aiChatCounts?.get(dto.id) ?? 0,
        ownerExcluded: excludedSessionIds.has(dto.id),
      }),
    })
  })

  server.get<{ Params: { id: string } }>('/_web/sessions/:id', async (request) => {
    const excludedSessionIds = new Set(preferences().load().ownerExcludedSessionIds)
    const session = sessionService.getAnalysisSession(adapter, request.params.id, {
      resolveOverview: (db, sessionId) => sessionService.resolveValidatedSessionOverview(db, sessionId, cacheDir),
      enrichSession: (dto) => ({ ...dto, ownerExcluded: excludedSessionIds.has(dto.id) }),
    })
    if (!session) {
      throw Object.assign(new Error(`Session not found: ${request.params.id}`), { statusCode: 404 })
    }
    if (ctx.aiChatManager) {
      session.aiConversationCount = ctx.aiChatManager.getAIChats(request.params.id).length
    }
    return session
  })

  server.delete<{ Params: { id: string } }>('/_web/sessions/:id', async (request, reply) => {
    const { id } = request.params
    await chatTopicWorkCoordinator.prepareSessionDelete(id)
    await ctx.beforeDeleteSession?.(id)
    const deleted = sessionService.deleteSession(adapter, id)
    if (!deleted) {
      return reply.code(404).send({ success: false, error: 'File not found' })
    }
    ownerProfileService.clearOwnerExclusions(preferences(), [id])
    return { success: true }
  })

  server.patch<{ Params: { id: string }; Body: { name: string } }>('/_web/sessions/:id/name', async (request) => {
    sessionService.renameSession(adapter, request.params.id, request.body.name)
    return { success: true }
  })

  server.patch<{ Params: { id: string }; Body: { ownerId: string | null } }>(
    '/_web/sessions/:id/owner',
    async (request) => {
      sessionService.updateSessionOwnerId(adapter, request.params.id, request.body.ownerId ?? null)
      if (request.body.ownerId) ownerProfileService.clearOwnerExclusions(preferences(), [request.params.id])
      return { success: true }
    }
  )

  // Try to auto-apply the stored platform owner profile to this session.
  server.post<{ Params: { id: string } }>('/_web/sessions/:id/owner/apply-profile', async (request) => {
    return ownerProfileService.tryApplyOwnerProfile(adapter, preferences(), request.params.id)
  })

  // Manually select owner: writes meta.owner_id, updates the platform profile,
  // and batch-applies it to other unowned same-platform sessions.
  server.post<{ Params: { id: string }; Body: { ownerPlatformId: string } }>(
    '/_web/sessions/:id/owner/select',
    async (request) => {
      return ownerProfileService.setOwnerAndApplyProfile(
        adapter,
        preferences(),
        request.params.id,
        request.body.ownerPlatformId
      )
    }
  )

  // Mark the session as not containing the current user.
  server.post<{ Params: { id: string } }>('/_web/sessions/:id/owner/exclude', async (request) => {
    ownerProfileService.excludeOwnerSession(preferences(), request.params.id)
    return { success: true }
  })
}
