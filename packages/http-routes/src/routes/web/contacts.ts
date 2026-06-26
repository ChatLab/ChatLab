import type { FastifyInstance } from 'fastify'
import type { ContactOverridePatch, ContactTier } from '@openchatlab/shared-types'
import { createContactsService } from '@openchatlab/node-runtime'
import type { HttpRouteContext } from '../../context'

type ContactsQuery = { acceptStale?: string }

const VALID_CONTACT_TIERS: ReadonlySet<ContactTier> = new Set([
  'core',
  'friend',
  'acquaintance',
  'high_interaction',
  'medium_interaction',
  'low_interaction',
])

export function registerContactsRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  const service = createContactsService({
    adapter: ctx.sessionAdapter,
    systemDir: ctx.pathProvider.getSystemDir(),
  })

  server.get<{ Querystring: ContactsQuery }>('/_web/contacts', async (request) => {
    return service.getContacts({ acceptStale: isTruthy(request.query.acceptStale) })
  })

  server.post('/_web/contacts/recompute', async () => {
    return service.getContacts({ forceRecompute: true })
  })

  server.patch<{ Params: { key: string }; Body: ContactOverridePatch }>(
    '/_web/contacts/:key/override',
    async (request) => {
      const patch = normalizeOverridePatch(request.body)
      service.setContactOverride(request.params.key, patch)
      return service.getContacts({ forceRecompute: true })
    }
  )

  server.delete<{ Params: { key: string } }>('/_web/contacts/:key/override', async (request) => {
    service.deleteContactOverride(request.params.key)
    return service.getContacts({ forceRecompute: true })
  })
}

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes'
}

function normalizeOverridePatch(value: unknown): ContactOverridePatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Invalid contact override patch'), { statusCode: 400 })
  }

  const lockedTier = (value as ContactOverridePatch).lockedTier
  if (lockedTier !== undefined && lockedTier !== null && !VALID_CONTACT_TIERS.has(lockedTier)) {
    throw Object.assign(new Error('Invalid contact lockedTier'), { statusCode: 400 })
  }

  return { lockedTier }
}
