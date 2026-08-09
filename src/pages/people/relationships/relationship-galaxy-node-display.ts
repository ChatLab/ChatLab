import type { PeopleRelationshipGraphNode, PeopleRelationshipsSearchResult } from '@openchatlab/shared-types'
import { maskRelationshipGalaxyPrivateText } from './relationship-galaxy-privacy'

type DisplayNode = PeopleRelationshipGraphNode | PeopleRelationshipsSearchResult

interface RelationshipGalaxyNodeDisplayOptions {
  privacyMode: boolean
  ownerLabel: string
}

export function getRelationshipGalaxyNodeDisplayName(
  node: DisplayNode,
  options: RelationshipGalaxyNodeDisplayOptions
): string {
  if (node.kind === 'owner') return options.ownerLabel
  const name = node.displayName || node.platformId || node.key
  return options.privacyMode ? maskRelationshipGalaxyPrivateText(name) : name
}

export function getRelationshipGalaxyNodeAvatarText(
  node: DisplayNode,
  options: RelationshipGalaxyNodeDisplayOptions
): string {
  if (node.kind === 'owner') return options.ownerLabel
  if (options.privacyMode) return '*'
  return (node.displayName || node.platformId || '?').slice(0, 1)
}

export function getRelationshipGalaxyNodeAvatarSrc(node: DisplayNode, privacyMode: boolean): string | null {
  if (node.kind === 'owner') return node.avatar
  return privacyMode ? null : node.avatar
}

export function getRelationshipGalaxyNodePlatformIdentity(
  node: PeopleRelationshipGraphNode,
  privacyMode: boolean
): string {
  const identity = node.platformId || node.key
  return privacyMode ? maskRelationshipGalaxyPrivateText(identity) : identity
}
