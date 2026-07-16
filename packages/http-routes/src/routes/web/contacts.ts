import type { FastifyInstance } from 'fastify'
import { createContactsService } from '@openchatlab/node-runtime'
import { CONTACTS_TIME_RANGE_PRESETS, type ContactPool, type ContactsTimeRangePreset } from '@openchatlab/shared-types'
import type { RuntimeRouteContext } from '../../context/runtime'
import type { ServiceRouteContext } from '../../context/services'

type ContactsQuery = {
  acceptStale?: string
  timeRange?: string
  pool?: string
  page?: string
  pageSize?: string
  q?: string
}

type ContactsRouteContext = Pick<
  RuntimeRouteContext,
  'sessionAdapter' | 'pathProvider' | 'runtimeIdentity' | 'nativeBinding'
> &
  Pick<ServiceRouteContext, 'contactsService'>

export function registerContactsRoutes(server: FastifyInstance, ctx: ContactsRouteContext): void {
  const service =
    ctx.contactsService ??
    createContactsService({
      adapter: ctx.sessionAdapter,
      pathProvider: ctx.pathProvider,
      runtimeIdentity: ctx.runtimeIdentity,
      nativeBinding: ctx.nativeBinding,
    })
  server.addHook('onClose', async () => {
    await service.close()
  })

  server.get<{ Querystring: ContactsQuery }>('/_web/contacts', async (request) => {
    return service.getContactsPage({
      acceptStale: isTruthy(request.query.acceptStale),
      timeRangePreset: parseContactsTimeRangePreset(request.query.timeRange),
      pool: parseContactPool(request.query.pool),
      page: parsePositiveInteger(request.query.page),
      pageSize: parsePositiveInteger(request.query.pageSize),
      query: request.query.q,
    })
  })

  server.post<{ Querystring: ContactsQuery }>('/_web/contacts/recompute', async (request) => {
    return service.startRecompute({
      timeRangePreset: parseContactsTimeRangePreset(request.query.timeRange),
      pool: parseContactPool(request.query.pool),
      page: parsePositiveInteger(request.query.page),
      pageSize: parsePositiveInteger(request.query.pageSize),
      query: request.query.q,
    })
  })

  server.get<{ Params: { key: string }; Querystring: ContactsQuery }>('/_web/contacts/:key/detail', async (request) => {
    return service.getContactDetail(request.params.key, {
      acceptStale: isTruthy(request.query.acceptStale),
      timeRangePreset: parseContactsTimeRangePreset(request.query.timeRange),
    })
  })

  server.put<{ Params: { key: string }; Querystring: ContactsQuery }>(
    '/_web/contacts/:key/mark-friend',
    async (request) => {
      return service.markContactAsFriend(request.params.key, {
        timeRangePreset: parseContactsTimeRangePreset(request.query.timeRange),
      })
    }
  )

  server.delete<{ Params: { key: string }; Querystring: ContactsQuery }>(
    '/_web/contacts/:key/mark-friend',
    async (request) => {
      return service.unmarkContactAsFriend(request.params.key, {
        timeRangePreset: parseContactsTimeRangePreset(request.query.timeRange),
      })
    }
  )
}

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes'
}

function parseContactsTimeRangePreset(value: string | undefined): ContactsTimeRangePreset {
  return CONTACTS_TIME_RANGE_PRESETS.includes(value as ContactsTimeRangePreset)
    ? (value as ContactsTimeRangePreset)
    : '1y'
}

function parseContactPool(value: string | undefined): ContactPool | undefined {
  return value === 'friend' || value === 'non_friend' ? value : undefined
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(1, Math.trunc(parsed))
}
