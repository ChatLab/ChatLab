import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from '../../context'
import { memberService } from '@openchatlab/node-runtime'

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
