import type { ContactListItem } from '@openchatlab/shared-types'

export type ContactPoolTab = 'friend' | 'non_friend'

export type ContactVirtualRow =
  | { type: 'section'; key: string; pool: ContactPoolTab }
  | { type: 'contact'; key: string; pool: ContactPoolTab; contact: ContactListItem }
  | { type: 'loading'; key: string; pool: ContactPoolTab }

export interface BuildContactVirtualRowsOptions {
  friends: ContactListItem[]
  groupmates: ContactListItem[]
  showGroupSection: boolean
  friendLoadingMore: boolean
  groupmateLoadingMore: boolean
}

export function buildContactVirtualRows(options: BuildContactVirtualRowsOptions): ContactVirtualRow[] {
  const rows: ContactVirtualRow[] = [{ type: 'section', key: 'section:friend', pool: 'friend' }]
  rows.push(
    ...options.friends.map((contact) => ({
      type: 'contact' as const,
      key: contact.key,
      pool: 'friend' as const,
      contact,
    }))
  )
  if (options.friendLoadingMore) rows.push({ type: 'loading', key: 'loading:friend', pool: 'friend' })

  if (options.showGroupSection) {
    rows.push({ type: 'section', key: 'section:non_friend', pool: 'non_friend' })
    rows.push(
      ...options.groupmates.map((contact) => ({
        type: 'contact' as const,
        key: contact.key,
        pool: 'non_friend' as const,
        contact,
      }))
    )
    if (options.groupmateLoadingMore) rows.push({ type: 'loading', key: 'loading:non_friend', pool: 'non_friend' })
  }

  return rows
}
