import { computed, inject, ref, watchEffect, type ComputedRef, type InjectionKey } from 'vue'

export type RankAvatarMap = ReadonlyMap<number, string | null>
export type RankAvatarNameMap = ReadonlyMap<string, string | null>

export interface RankAvatarIndex {
  byId: RankAvatarMap
  byName: RankAvatarNameMap
}

export const RANKING_AVATAR_MAP_KEY: InjectionKey<{ value: RankAvatarIndex }> = Symbol('ranking-avatar-map')

const EMPTY_AVATAR_MAP: RankAvatarMap = new Map()
const EMPTY_AVATAR_INDEX: RankAvatarIndex = { byId: EMPTY_AVATAR_MAP, byName: new Map() }
const CHART_AVATAR_SIZE = 36
const circularBySrc = new Map<string, string>()
const inflightSrcs = new Set<string>()
const failedSrcs = new Set<string>()
/** Shared so every mounted ranking chart rerenders when any avatar clip finishes. */
const circularClipRevision = ref(0)

export type RankAvatarMember = {
  memberId?: number
  id?: string | number
  avatar?: string | null
}

export function buildRankAvatarMap(members: Array<{ id: number; avatar?: string | null }>): RankAvatarMap {
  const map = new Map<number, string | null>()
  for (const member of members) {
    const avatar = member.avatar?.trim()
    map.set(member.id, avatar ? avatar : null)
  }
  return map
}

function normalizedAvatar(avatar?: string | null): string | null {
  const trimmed = avatar?.trim()
  return trimmed ? trimmed : null
}

function rememberAvatarName(map: Map<string, string | null>, name: string | null | undefined, avatar: string | null) {
  const key = name?.trim()
  if (!key) return
  const existing = map.get(key)
  if (existing) return
  if (avatar) map.set(key, avatar)
  else if (!map.has(key)) map.set(key, null)
}

export function buildRankAvatarNameMap(
  members: Array<{
    groupNickname?: string | null
    accountName?: string | null
    platformId?: string | null
    aliases?: string[]
    avatar?: string | null
  }>
): RankAvatarNameMap {
  const map = new Map<string, string | null>()
  for (const member of members) {
    const avatar = normalizedAvatar(member.avatar)
    rememberAvatarName(map, member.groupNickname, avatar)
    rememberAvatarName(map, member.accountName, avatar)
    rememberAvatarName(map, member.platformId, avatar)
    rememberAvatarName(map, member.groupNickname || member.accountName || member.platformId, avatar)
    for (const alias of member.aliases ?? []) rememberAvatarName(map, alias, avatar)
  }
  return map
}

export function buildRankAvatarIndex(
  members: Array<{
    id: number
    groupNickname?: string | null
    accountName?: string | null
    platformId?: string | null
    aliases?: string[]
    avatar?: string | null
  }>
): RankAvatarIndex {
  return {
    byId: buildRankAvatarMap(members),
    byName: buildRankAvatarNameMap(members),
  }
}

export function resolveRankAvatar(
  memberId: number | string | undefined,
  explicit: string | null | undefined,
  avatars: RankAvatarMap,
  fallback?: { name?: string | null; byName?: RankAvatarNameMap }
): string | null {
  const trimmed = explicit?.trim()
  if (trimmed) return trimmed
  if (memberId != null && memberId !== '') {
    const id = typeof memberId === 'number' ? memberId : Number(memberId)
    if (Number.isFinite(id)) {
      const fromId = avatars.get(id)
      if (fromId) return fromId
    }
  }
  const name = fallback?.name?.trim()
  if (name && fallback?.byName) return fallback.byName.get(name) ?? null
  if (memberId == null || memberId === '') return null
  const id = typeof memberId === 'number' ? memberId : Number(memberId)
  if (!Number.isFinite(id)) return null
  return avatars.get(id) ?? null
}

export function getRankAvatarText(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed.slice(0, 1) : '?'
}

export function attachRankAvatars<T>(
  items: T[],
  getMemberId: (item: T) => number | string,
  avatars: RankAvatarMap
): Array<T & { avatar: string | null }> {
  return items.map((item) => ({
    ...item,
    avatar: resolveRankAvatar(getMemberId(item), (item as { avatar?: string | null }).avatar, avatars),
  }))
}

export function useRankAvatarIndex(): ComputedRef<RankAvatarIndex> {
  const provided = inject(RANKING_AVATAR_MAP_KEY, null)
  return computed(() => provided?.value ?? EMPTY_AVATAR_INDEX)
}

export function useRankAvatarMap(): ComputedRef<RankAvatarMap> {
  const index = useRankAvatarIndex()
  return computed(() => index.value.byId)
}

/** ECharts cannot clip `backgroundColor.image` to a circle; only a pre-clipped bitmap looks round. */
export function chartSafeAvatarSrc(
  src: string | null | undefined,
  circularCache: ReadonlyMap<string, string>
): string | null {
  if (!src) return null
  return circularCache.get(src) ?? null
}

export function clipAvatarToCircle(src: string, size = CHART_AVATAR_SIZE): Promise<string | null> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return Promise.resolve(null)

  return new Promise((resolve) => {
    const image = new Image()
    if (/^https?:/i.test(src)) image.crossOrigin = 'anonymous'

    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const context = canvas.getContext('2d')
        if (!context) {
          resolve(null)
          return
        }

        context.beginPath()
        context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
        context.closePath()
        context.clip()

        const width = image.naturalWidth || image.width
        const height = image.naturalHeight || image.height
        if (width <= 0 || height <= 0) {
          resolve(null)
          return
        }

        const scale = Math.max(size / width, size / height)
        const drawWidth = width * scale
        const drawHeight = height * scale
        context.drawImage(image, (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve(null)
      }
    }
    image.onerror = () => resolve(null)
    image.src = src
  })
}

export function useCircularRankAvatarMap(members: () => RankAvatarMember[]): ComputedRef<RankAvatarMap> {
  const rawMap = useRankAvatarMap()

  watchEffect(() => {
    const raw = rawMap.value
    for (const member of members()) {
      const src = resolveRankAvatar(member.memberId ?? member.id, member.avatar, raw)
      if (!src || circularBySrc.has(src) || failedSrcs.has(src) || inflightSrcs.has(src)) continue
      inflightSrcs.add(src)
      void clipAvatarToCircle(src).then((circular) => {
        inflightSrcs.delete(src)
        if (circular) circularBySrc.set(src, circular)
        else failedSrcs.add(src)
        circularClipRevision.value += 1
      })
    }
  })

  return computed(() => {
    void circularClipRevision.value
    const raw = rawMap.value
    const prepared = new Map<number, string | null>()
    for (const member of members()) {
      const key = member.memberId ?? member.id
      const id = typeof key === 'number' ? key : Number(key)
      if (!Number.isFinite(id)) continue
      const src = resolveRankAvatar(key, member.avatar, raw)
      prepared.set(id, chartSafeAvatarSrc(src, circularBySrc))
    }
    return prepared
  })
}
