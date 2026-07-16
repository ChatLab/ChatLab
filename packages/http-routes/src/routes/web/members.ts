import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from '../../context'
import { appLogger, memberService } from '@openchatlab/node-runtime'
import { apiErrorFromUnknown } from '../../errors'

export function registerMemberRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  const { sessionAdapter: adapter } = ctx

  server.get<{ Params: { id: string } }>('/_web/sessions/:id/members', async (request) => {
    return memberService.getMembers(adapter, request.params.id)
  })

  server.get<{
    Params: { id: string }
    Querystring: { page?: string; pageSize?: string; search?: string; sortOrder?: string }
  }>('/_web/sessions/:id/members/paginated', async (request) => {
    return memberService.getMembersPaginated(adapter, request.params.id, {
      page: parseInt(request.query.page || '1', 10),
      pageSize: parseInt(request.query.pageSize || '20', 10),
      search: request.query.search,
      sortOrder: request.query.sortOrder === 'asc' ? 'asc' : 'desc',
    })
  })

  server.patch<{ Params: { id: string; memberId: string }; Body: { aliases: string[] } }>(
    '/_web/sessions/:id/members/:memberId/aliases',
    async (request) => {
      const memberId = parseInt(request.params.memberId, 10)
      memberService.updateMemberAliases(adapter, request.params.id, memberId, request.body.aliases)
      return { success: true }
    }
  )

  server.delete<{ Params: { id: string; memberId: string } }>(
    '/_web/sessions/:id/members/:memberId',
    async (request) => {
      const memberId = parseInt(request.params.memberId, 10)
      memberService.deleteMember(adapter, request.params.id, memberId)
      return { success: true }
    }
  )

  server.post<{ Params: { id: string }; Body: { memberIds?: unknown } }>(
    '/_web/sessions/:id/members/batch-delete',
    async (request, reply) => {
      const memberIds = request.body?.memberIds
      if (
        !Array.isArray(memberIds) ||
        memberIds.length === 0 ||
        memberIds.some((memberId) => !Number.isSafeInteger(memberId) || Number(memberId) <= 0)
      ) {
        return reply.code(400).send({
          success: false,
          error: 'memberIds must contain at least one positive integer',
        })
      }

      const uniqueMemberIds = Array.from(new Set(memberIds as number[]))
      try {
        const success = memberService.deleteMembers(adapter, request.params.id, uniqueMemberIds)
        if (!success) {
          throw new Error('Member deletion transaction returned no result')
        }
      } catch (error) {
        if (apiErrorFromUnknown(error)) throw error
        appLogger.error('members', 'Batch member deletion failed', error)
        return reply.code(500).send({ success: false, error: 'Failed to delete selected members' })
      }

      appLogger.info('members', 'Batch member deletion completed', {
        sessionId: request.params.id,
        memberCount: uniqueMemberIds.length,
      })
      return { success: true, deletedCount: uniqueMemberIds.length }
    }
  )

  server.post<{ Params: { id: string }; Body: { memberId1: number; memberId2: number } }>(
    '/_web/sessions/:id/members/merge',
    async (request) => {
      const { memberId1, memberId2 } = request.body
      memberService.mergeMembers(adapter, request.params.id, memberId1, memberId2)
      return { success: true }
    }
  )

  server.get<{ Params: { id: string; memberId: string } }>(
    '/_web/sessions/:id/members/:memberId/history',
    async (request) => {
      const memberId = parseInt(request.params.memberId, 10)
      return memberService.getMemberNameHistory(adapter, request.params.id, memberId)
    }
  )
}
