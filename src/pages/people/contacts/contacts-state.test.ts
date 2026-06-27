/**
 * Run: pnpm test -- src/pages/people/contacts/contacts-state.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import type { ContactsDiagnostics } from '@openchatlab/shared-types'
import {
  resolveFriendActionScrollTop,
  resolveContactsPollingPools,
  shouldShowContactsDisabledNotice,
  shouldShowGroupmateSection,
  shouldShowContactsLoadingState,
  shouldHoldCompletedContactsTaskProgress,
  shouldPreserveFriendActionRefreshRows,
  shouldWaitForStableContactNavigationRows,
} from './contacts-state'

function diagnostics(overrides: Partial<ContactsDiagnostics> = {}): ContactsDiagnostics {
  return {
    privateSessionCount: 0,
    activePrivateSessionCount: 0,
    contactsEnabled: false,
    skippedMissingOwnerSessions: 0,
    skippedUnresolvedOwnerSessions: 0,
    skippedAmbiguousPrivateSessions: 0,
    skippedInvalidPlatformIdMembers: 0,
    skippedFailedSessions: 0,
    warnings: [],
    ...overrides,
  }
}

test('does not show contacts disabled notice while the contacts response is still loading', () => {
  assert.equal(
    shouldShowContactsDisabledNotice({
      diagnostics: diagnostics({ activePrivateSessionCount: 0 }),
      showLoadingState: true,
    }),
    false
  )
})

test('shows contacts disabled notice after loading when active private sessions are below the threshold', () => {
  assert.equal(
    shouldShowContactsDisabledNotice({
      diagnostics: diagnostics({ activePrivateSessionCount: 0 }),
      showLoadingState: false,
    }),
    true
  )
})

test('does not show contacts disabled notice when contacts are enabled', () => {
  assert.equal(
    shouldShowContactsDisabledNotice({
      diagnostics: diagnostics({ activePrivateSessionCount: 11, contactsEnabled: true }),
      showLoadingState: false,
    }),
    false
  )
})

test('keeps groupmate friend action refresh at the previous viewport position', () => {
  assert.equal(
    resolveFriendActionScrollTop({
      activeSection: 'non_friend',
      previousScrollTop: 800,
      groupSectionScrollTop: 850,
    }),
    800
  )
})

test('does not remap groupmate friend action scroll by section offsets', () => {
  assert.equal(
    resolveFriendActionScrollTop({
      activeSection: 'non_friend',
      previousScrollTop: 14_001,
      groupSectionScrollTop: 6_901,
    }),
    14_001
  )
})

test('preserves scroll position for friend section friend actions', () => {
  assert.equal(
    resolveFriendActionScrollTop({
      activeSection: 'friend',
      previousScrollTop: 320,
      groupSectionScrollTop: 850,
    }),
    320
  )
})

test('replaces friend rows after a groupmate is marked as friend', () => {
  assert.equal(shouldPreserveFriendActionRefreshRows('friend'), false)
})

test('keeps preserving groupmate rows after local removal during friend actions', () => {
  assert.equal(shouldPreserveFriendActionRefreshRows('non_friend'), true)
})

test('waits before navigating to groupmates while initial contact rows are loading', () => {
  assert.equal(
    shouldWaitForStableContactNavigationRows({
      targetPool: 'non_friend',
      friendInitialLoading: true,
      groupmateInitialLoading: false,
    }),
    true
  )
  assert.equal(
    shouldWaitForStableContactNavigationRows({
      targetPool: 'non_friend',
      friendInitialLoading: false,
      groupmateInitialLoading: true,
    }),
    true
  )
})

test('does not wait for contact navigation once target rows are stable', () => {
  assert.equal(
    shouldWaitForStableContactNavigationRows({
      targetPool: 'non_friend',
      friendInitialLoading: false,
      groupmateInitialLoading: false,
    }),
    false
  )
  assert.equal(
    shouldWaitForStableContactNavigationRows({
      targetPool: 'friend',
      friendInitialLoading: true,
      groupmateInitialLoading: true,
    }),
    false
  )
})

test('shows groupmate section immediately when the groupmate tab is active', () => {
  assert.equal(
    shouldShowGroupmateSection({
      activeSection: 'non_friend',
      friendSectionReady: false,
      groupmateHasItems: false,
      groupmateLoading: true,
    }),
    true
  )
})

test('does not insert prefetched groupmates into the friend tab before friends are ready', () => {
  assert.equal(
    shouldShowGroupmateSection({
      activeSection: 'friend',
      friendSectionReady: false,
      groupmateHasItems: true,
      groupmateLoading: false,
    }),
    false
  )
})

test('keeps the contacts table hidden while either contacts pool task is running', () => {
  assert.equal(
    shouldShowContactsLoadingState({
      friendInitialLoading: false,
      groupmateInitialLoading: false,
      friendTaskStatus: 'succeeded',
      groupmateTaskStatus: 'running',
    }),
    true
  )
})

test('keeps the contacts table hidden until both first pages finish loading', () => {
  assert.equal(
    shouldShowContactsLoadingState({
      friendInitialLoading: false,
      groupmateInitialLoading: true,
      friendTaskStatus: 'succeeded',
      groupmateTaskStatus: undefined,
    }),
    true
  )
})

test('keeps the contacts table hidden while completed progress is being displayed', () => {
  assert.equal(
    shouldShowContactsLoadingState({
      friendInitialLoading: false,
      groupmateInitialLoading: false,
      friendTaskStatus: 'succeeded',
      groupmateTaskStatus: 'succeeded',
      completionProgressVisible: true,
    }),
    true
  )
})

test('holds completed contacts progress after a running task finishes before the last visible progress reached total', () => {
  assert.equal(
    shouldHoldCompletedContactsTaskProgress({
      previousStatus: 'running',
      nextStatus: 'succeeded',
      previousProcessedSessions: 304,
      nextProcessedSessions: 643,
      nextTotalSessions: 643,
    }),
    true
  )
})

test('does not hold completed contacts progress when running progress already reached total', () => {
  assert.equal(
    shouldHoldCompletedContactsTaskProgress({
      previousStatus: 'running',
      nextStatus: 'succeeded',
      previousProcessedSessions: 643,
      nextProcessedSessions: 643,
      nextTotalSessions: 643,
    }),
    false
  )
})

test('polls both contact pools while a non-active pool still has a running task', () => {
  assert.deepEqual(
    resolveContactsPollingPools({
      activePool: 'friend',
      friendTaskStatus: 'succeeded',
      groupmateTaskStatus: 'running',
    }),
    ['friend', 'non_friend']
  )
})

test('polls only the active contact pool when no pool task is running', () => {
  assert.deepEqual(
    resolveContactsPollingPools({
      activePool: 'non_friend',
      friendTaskStatus: 'succeeded',
      groupmateTaskStatus: 'succeeded',
    }),
    ['non_friend']
  )
})
