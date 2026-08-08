import type {
  GroupRelationshipGalaxyData,
  GroupRelationshipGalaxyEdgeDetail,
  GroupRelationshipGalaxyMemberDetail,
} from '@openchatlab/shared-types'

/** 构造关系详情面板展示的邻接成员列表。 */

export interface GroupRelationshipGalaxyConnection {
  member: GroupRelationshipGalaxyMemberDetail
  edge: GroupRelationshipGalaxyEdgeDetail
}

export interface GroupRelationshipGalaxyDisplayState {
  content: 'loading' | 'error' | 'webgl-unavailable' | 'empty' | 'canvas'
  showLoadingOverlay: boolean
}

export function resolveGroupRelationshipGalaxyDisplayState(options: {
  isLoading: boolean
  hasGraph: boolean
  hasError: boolean
  webglUnavailable: boolean
}): GroupRelationshipGalaxyDisplayState {
  if (options.hasError) return { content: 'error', showLoadingOverlay: false }
  if (options.webglUnavailable) return { content: 'webgl-unavailable', showLoadingOverlay: false }
  if (options.hasGraph) return { content: 'canvas', showLoadingOverlay: options.isLoading }
  if (options.isLoading) return { content: 'loading', showLoadingOverlay: false }
  return { content: 'empty', showLoadingOverlay: false }
}

export function buildGroupRelationshipGalaxyConnections(
  data: GroupRelationshipGalaxyData | null,
  selectedKey: string | null,
  limit = 10
): GroupRelationshipGalaxyConnection[] {
  if (!data || !selectedKey) return []
  const memberByKey = new Map(data.members.map((member) => [member.key, member]))
  return data.edges
    .flatMap((edge): GroupRelationshipGalaxyConnection[] => {
      if (edge.sourceKey !== selectedKey && edge.targetKey !== selectedKey) return []
      const otherKey = edge.sourceKey === selectedKey ? edge.targetKey : edge.sourceKey
      const member = memberByKey.get(otherKey)
      return member ? [{ member, edge }] : []
    })
    .sort(
      (a, b) =>
        b.edge.weight - a.edge.weight ||
        (b.edge.lastInteractionTs ?? 0) - (a.edge.lastInteractionTs ?? 0) ||
        a.member.rank - b.member.rank ||
        a.member.key.localeCompare(b.member.key)
    )
    .slice(0, Math.max(0, limit))
}
