import type {
  RestMessageQuery,
  RestSessionDetail,
  RestSessionExportData,
  RestSessionOverview,
  RestSessionProvider,
  RestSessionSummary,
} from '@openchatlab/http-routes/rest'
import { normalizeRestSessionMember } from '@openchatlab/http-routes/rest'
import * as worker from '../worker/workerManager'

interface DesktopSessionData {
  id: string
  name: string
  platform: string
  type: string
  groupId?: string | null
  messageCount: number
  memberCount: number
  firstTimestamp?: number | null
  lastTimestamp?: number | null
  firstMessageTs?: number | null
  lastMessageTs?: number | null
  lastPlatformMessageId?: string | null
  importedAt?: number
}

interface DesktopMemberActivity {
  platformId: string
  name: string
  messageCount: number
  percentage: number
}

interface DesktopMessageTypeStat {
  type: number
  count: number
}

function toSummary(session: DesktopSessionData): RestSessionSummary {
  return {
    id: session.id,
    name: session.name,
    platform: session.platform,
    type: session.type,
    groupId: session.groupId || undefined,
    messageCount: session.messageCount,
    memberCount: session.memberCount,
    firstTimestamp: session.firstTimestamp ?? session.firstMessageTs ?? null,
    lastTimestamp: session.lastTimestamp ?? session.lastMessageTs ?? null,
    importedAt: session.importedAt,
  }
}

function toDetail(session: DesktopSessionData): RestSessionDetail {
  return {
    ...toSummary(session),
    lastPlatformMessageId: session.lastPlatformMessageId ?? null,
    importedAt: session.importedAt ?? 0,
  }
}

async function getSession(sessionId: string): Promise<RestSessionDetail | null> {
  const session = (await worker.getSession(sessionId)) as DesktopSessionData | null
  return session ? toDetail(session) : null
}

async function getMessages(sessionId: string, query: RestMessageQuery) {
  const session = await getSession(sessionId)
  if (!session) return null

  const filter =
    query.startTime !== undefined || query.endTime !== undefined
      ? { startTs: query.startTime, endTs: query.endTime }
      : undefined
  const result = await worker.searchMessages(
    sessionId,
    query.keyword ? [query.keyword] : [],
    filter,
    query.limit,
    query.offset,
    query.senderId
  )
  return { ...result, totalPages: Math.ceil(result.total / query.limit) }
}

export function createDesktopRestSessionProvider(): RestSessionProvider {
  return {
    countSessions: async () => (await worker.getAllSessions()).length,
    listSessions: async () => ((await worker.getAllSessions()) as DesktopSessionData[]).map(toSummary),
    getSession,
    queryMessages: getMessages,
    getMembers: async (sessionId) => {
      if (!(await getSession(sessionId))) return null
      return (await worker.getMembers(sessionId)).map(normalizeRestSessionMember)
    },
    getOverview: async (sessionId): Promise<RestSessionOverview | null> => {
      const session = await getSession(sessionId)
      if (!session) return null

      const [timeRange, memberActivity, typeDistribution] = await Promise.all([
        worker.getTimeRange(sessionId),
        worker.getMemberActivity(sessionId) as Promise<DesktopMemberActivity[]>,
        worker.getMessageTypeDistribution(sessionId) as Promise<DesktopMessageTypeStat[]>,
      ])
      const messageTypeDistribution: Record<string, number> = {}
      for (const item of typeDistribution) {
        messageTypeDistribution[String(item.type)] = item.count
      }

      return {
        messageCount: session.messageCount,
        memberCount: session.memberCount,
        timeRange: timeRange ?? { start: 0, end: 0 },
        messageTypeDistribution,
        topMembers: memberActivity.slice(0, 10).map((member) => ({
          platformId: member.platformId,
          name: member.name,
          messageCount: member.messageCount,
          percentage: member.percentage,
        })),
      }
    },
    executeReadonlySql: async (sessionId, sql) => {
      if (!(await getSession(sessionId))) return null
      return worker.executeRawSQL(sessionId, sql)
    },
    getExportData: async (sessionId, limit): Promise<RestSessionExportData | null> => {
      const session = await getSession(sessionId)
      if (!session) return null

      const [members, messagePage] = await Promise.all([
        worker.getMembers(sessionId),
        worker.searchMessages(sessionId, [], undefined, limit, 0),
      ])
      return {
        members,
        messages: messagePage.messages,
      }
    },
  }
}
