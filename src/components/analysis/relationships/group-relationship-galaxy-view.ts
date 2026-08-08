import type {
  GroupRelationshipGalaxyData,
  GroupRelationshipGalaxyEdgeDetail,
  GroupRelationshipGalaxyMemberDetail,
} from '@openchatlab/shared-types'

export interface GroupRelationshipGalaxyConnection {
  member: GroupRelationshipGalaxyMemberDetail
  edge: GroupRelationshipGalaxyEdgeDetail
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
