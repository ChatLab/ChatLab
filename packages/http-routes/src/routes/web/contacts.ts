import type { FastifyInstance } from 'fastify'
import { createContactsService } from '@openchatlab/node-runtime'
import type { HttpRouteContext } from '../../context'

type ContactsQuery = { acceptStale?: string }

export function registerContactsRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  const service =
    ctx.contactsService ??
    createContactsService({
      adapter: ctx.sessionAdapter,
      pathProvider: ctx.pathProvider,
      runtimeIdentity: ctx.runtimeIdentity,
      nativeBinding: ctx.nativeBinding,
    })

  server.get<{ Querystring: ContactsQuery }>('/_web/contacts', async (request) => {
    return service.getContacts({ acceptStale: isTruthy(request.query.acceptStale) })
  })

  server.post('/_web/contacts/recompute', async () => {
    return service.startRecompute()
  })
}

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes'
}
