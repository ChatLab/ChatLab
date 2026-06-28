import type { FastifyInstance } from 'fastify'
import {
  CONTACTS_TIME_RANGE_PRESETS,
  type ContactsTimeRangePreset,
  type PeopleRelationshipsGraphScope,
} from '@openchatlab/shared-types'
import { createPeopleRelationshipsService } from '@openchatlab/node-runtime'
import type { HttpRouteContext } from '../../context'

type PeopleRelationshipsQuery = {
  acceptStale?: string
  timeRange?: string
  scope?: string
  q?: string
}

export function registerPeopleRelationshipsRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  const service =
    ctx.peopleRelationshipsService ??
    createPeopleRelationshipsService({
      adapter: ctx.sessionAdapter,
      pathProvider: ctx.pathProvider,
      runtimeIdentity: ctx.runtimeIdentity,
      nativeBinding: ctx.nativeBinding,
    })
  server.addHook('onClose', async () => {
    await service.close()
  })

  server.get<{ Querystring: PeopleRelationshipsQuery }>('/_web/people/relationships', async (request) => {
    return service.getGraph({
      acceptStale: isTruthy(request.query.acceptStale),
      timeRangePreset: parseContactsTimeRangePreset(request.query.timeRange),
      graphScope: parsePeopleRelationshipsGraphScope(request.query.scope),
      query: request.query.q,
    })
  })

  server.post<{ Querystring: PeopleRelationshipsQuery }>('/_web/people/relationships/recompute', async (request) => {
    return service.startRecompute({
      timeRangePreset: parseContactsTimeRangePreset(request.query.timeRange),
      graphScope: parsePeopleRelationshipsGraphScope(request.query.scope),
      query: request.query.q,
    })
  })

  server.get<{ Params: { key: string }; Querystring: PeopleRelationshipsQuery }>(
    '/_web/people/relationships/:key/neighborhood',
    async (request) => {
      return service.getNeighborhood(request.params.key, {
        acceptStale: isTruthy(request.query.acceptStale),
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

function parsePeopleRelationshipsGraphScope(value: string | undefined): PeopleRelationshipsGraphScope {
  return value === 'close' ? 'close' : 'panorama'
}
