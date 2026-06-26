import type { FastifyInstance } from 'fastify'
import { createContactsService } from '@openchatlab/node-runtime'
import type { HttpRouteContext } from '../../context'

type ContactsQuery = { acceptStale?: string }

export function registerContactsRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  const service = createContactsService({
    adapter: ctx.sessionAdapter,
  })

  server.get<{ Querystring: ContactsQuery }>('/_web/contacts', async (request) => {
    return service.getContacts({ acceptStale: isTruthy(request.query.acceptStale) })
  })

  server.post('/_web/contacts/recompute', async () => {
    return service.getContacts({ forceRecompute: true })
  })
}

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes'
}
