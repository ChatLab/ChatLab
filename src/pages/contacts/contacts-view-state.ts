import type { ContactsDiagnostics, ContactsTaskStatus } from '@openchatlab/shared-types'
import type { ContactPoolTab } from './contacts-virtual-list'

export interface ContactsDisabledNoticeState {
  diagnostics: ContactsDiagnostics | null | undefined
  showLoadingState: boolean
}

export interface FriendActionScrollState {
  activeSection: ContactPoolTab
  previousScrollTop: number
  groupSectionScrollTop: number | null
}

export interface GroupmateSectionVisibilityState {
  activeSection: ContactPoolTab
  friendSectionReady: boolean
  groupmateHasItems: boolean
  groupmateLoading: boolean
}

export interface ContactsLoadingVisibilityState {
  friendInitialLoading: boolean
  groupmateInitialLoading: boolean
  completionProgressVisible?: boolean
  activeTaskStatus?: ContactsTaskStatus
  friendTaskStatus?: ContactsTaskStatus
  groupmateTaskStatus?: ContactsTaskStatus
}

export interface CompletedContactsTaskProgressState {
  previousStatus?: ContactsTaskStatus
  nextStatus?: ContactsTaskStatus
  previousProcessedSessions: number
  nextProcessedSessions: number
  nextTotalSessions: number
}

export interface ContactsPollingPoolsState {
  activePool: ContactPoolTab
  friendTaskStatus?: ContactsTaskStatus
  groupmateTaskStatus?: ContactsTaskStatus
}

export function shouldShowContactsDisabledNotice(state: ContactsDisabledNoticeState): boolean {
  return !!state.diagnostics && !state.showLoadingState && !state.diagnostics.contactsEnabled
}

export function resolveFriendActionScrollTop(state: FriendActionScrollState): number {
  return state.previousScrollTop
}

export function shouldPreserveFriendActionRefreshRows(pool: ContactPoolTab): boolean {
  return pool !== 'friend'
}

export function shouldShowGroupmateSection(state: GroupmateSectionVisibilityState): boolean {
  return state.activeSection === 'non_friend' || state.friendSectionReady
}

export function shouldShowContactsLoadingState(state: ContactsLoadingVisibilityState): boolean {
  return (
    state.friendInitialLoading ||
    state.groupmateInitialLoading ||
    state.completionProgressVisible === true ||
    state.activeTaskStatus === 'running' ||
    state.friendTaskStatus === 'running' ||
    state.groupmateTaskStatus === 'running'
  )
}

export function shouldHoldCompletedContactsTaskProgress(state: CompletedContactsTaskProgressState): boolean {
  return (
    state.previousStatus === 'running' &&
    state.nextStatus === 'succeeded' &&
    state.nextTotalSessions > 0 &&
    state.nextProcessedSessions >= state.nextTotalSessions &&
    state.previousProcessedSessions < state.nextTotalSessions
  )
}

export function resolveContactsPollingPools(state: ContactsPollingPoolsState): ContactPoolTab[] {
  if (state.friendTaskStatus === 'running' || state.groupmateTaskStatus === 'running') {
    return ['friend', 'non_friend']
  }
  return [state.activePool]
}
