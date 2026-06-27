<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { CONTACTS_TIME_RANGE_PRESETS } from '@openchatlab/shared-types'
import type {
  ContactItem,
  ContactListItem,
  ContactsResponse,
  ContactsTaskState,
  ContactsTimeRangePreset,
} from '@openchatlab/shared-types'
import { useDataService } from '@/services'
import { useToast } from '@/composables/useToast'
import { useLayoutStore } from '@/stores/layout'
import PageHeader from '@/components/layout/PageHeader.vue'
import { LoadingState, SubTabs } from '@/components/UI'
import PeopleSubnav from '../components/PeopleSubnav.vue'
import ContactDetailPanel from './components/ContactDetailPanel.vue'
import ContactsStatusBlocks from './components/ContactsStatusBlocks.vue'
import {
  resolveFriendActionScrollTop,
  resolveContactsPollingPools,
  shouldHoldCompletedContactsTaskProgress,
  shouldPreserveFriendActionRefreshRows,
  shouldShowContactsDisabledNotice,
  shouldShowContactsLoadingState,
  shouldShowGroupmateSection,
  shouldWaitForStableContactNavigationRows,
} from './contacts-state'
import { buildContactVirtualRows, type ContactPoolTab, type ContactVirtualRow } from './contacts-virtual-rows'

interface ContactsTabState {
  items: ContactListItem[]
  response: ContactsResponse | null
  page: number
  total: number
  hasMore: boolean
  isLoadingInitial: boolean
  isLoadingMore: boolean
  error: string
  requestId: number
  scrollOffset: number
}

const CONTACTS_PAGE_SIZE = 100
const CONTACTS_ROW_ESTIMATE = 69
const CONTACTS_LOAD_MORE_REMAINING = 20

const { t } = useI18n()
const toast = useToast()
const dataService = useDataService()
const layoutStore = useLayoutStore()
const router = useRouter()

const isRecomputing = ref(false)
const searchQuery = ref('')
const debouncedSearchQuery = ref('')
const timeRangePreset = ref<ContactsTimeRangePreset>('1y')
const activeContactSection = ref<ContactPoolTab>('friend')
const selectedKey = ref<string | null>(null)
const selectedContact = ref<ContactItem | null>(null)
const isDetailLoading = ref(false)
const isFriendActionSaving = ref(false)
const pollTimer = ref<ReturnType<typeof setInterval> | null>(null)
const isPollingContacts = ref(false)
const completedTaskForDisplay = ref<ContactsTaskState | null>(null)
const completedTaskDisplayTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const searchTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const tabNavigationTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const firstPageLoads: Record<ContactPoolTab, Promise<void> | null> = {
  friend: null,
  non_friend: null,
}
const isTabNavigationScrolling = ref(false)
const scrollContainerRef = ref<HTMLElement | null>(null)
const tableBodyRef = ref<HTMLElement | null>(null)
const tableScrollLeft = ref(0)
const detailCache = ref<Record<string, ContactItem>>({})

function createTabState(): ContactsTabState {
  return {
    items: [],
    response: null,
    page: 0,
    total: 0,
    hasMore: false,
    isLoadingInitial: false,
    isLoadingMore: false,
    error: '',
    requestId: 0,
    scrollOffset: 0,
  }
}

const tabStates = ref<Record<ContactPoolTab, ContactsTabState>>({
  friend: createTabState(),
  non_friend: createTabState(),
})

const activeState = computed(() => tabStates.value[activeContactSection.value])
const friendState = computed(() => tabStates.value.friend)
const groupmateState = computed(() => tabStates.value.non_friend)
const friendSectionReadyForGroupmates = computed(
  () => !!friendState.value.response && !friendState.value.hasMore && !friendState.value.isLoadingInitial
)
const showGroupSection = computed(() =>
  shouldShowGroupmateSection({
    activeSection: activeContactSection.value,
    friendSectionReady: friendSectionReadyForGroupmates.value,
    groupmateHasItems: groupmateState.value.items.length > 0,
    groupmateLoading: groupmateState.value.isLoadingInitial || groupmateState.value.isLoadingMore,
  })
)
const virtualRows = computed(() =>
  buildContactVirtualRows({
    friends: friendState.value.items,
    groupmates: groupmateState.value.items,
    showGroupSection: showGroupSection.value,
    friendLoadingMore: friendState.value.isLoadingMore,
    groupmateLoadingMore: groupmateState.value.isLoadingInitial || groupmateState.value.isLoadingMore,
  })
)
const response = computed(
  () => activeState.value.response ?? friendState.value.response ?? groupmateState.value.response
)
const taskResponse = computed(
  () =>
    [activeState.value.response, friendState.value.response, groupmateState.value.response].find(
      (next) => next?.task?.status === 'running'
    ) ?? response.value
)
const hasAnyContacts = computed(() => friendState.value.items.length + groupmateState.value.items.length > 0)
const showEmptyState = computed(
  () =>
    !hasAnyContacts.value &&
    !!friendState.value.response &&
    !!groupmateState.value.response &&
    !friendState.value.hasMore &&
    !groupmateState.value.hasMore &&
    !friendState.value.isLoadingInitial &&
    !groupmateState.value.isLoadingInitial
)
const pageError = computed(() => friendState.value.error || groupmateState.value.error)
const diagnostics = computed(() => response.value?.diagnostics)
const task = computed(() => taskResponse.value?.task)
const displayTask = computed(() => completedTaskForDisplay.value ?? task.value)
const isTaskRunning = computed(() => task.value?.status === 'running')
const taskFailed = computed(() => task.value?.status === 'failed')
const showLoadingState = computed(() =>
  shouldShowContactsLoadingState({
    activeTaskStatus: activeState.value.response?.task?.status,
    friendTaskStatus: friendState.value.response?.task?.status,
    groupmateTaskStatus: groupmateState.value.response?.task?.status,
    friendInitialLoading: friendState.value.isLoadingInitial,
    groupmateInitialLoading: groupmateState.value.isLoadingInitial,
    completionProgressVisible: completedTaskForDisplay.value !== null,
  })
)
const loadingStateText = computed(() => {
  if (completedTaskForDisplay.value) {
    return t('contacts.task.running', {
      current: displayTask.value?.processedSessions ?? 0,
      total: displayTask.value?.totalSessions ?? 0,
    })
  }
  if (taskResponse.value?.cache.status === 'stale' && isTaskRunning.value) return t('contacts.task.updating')
  if (taskResponse.value?.cache.status === 'missing' && isTaskRunning.value) {
    return t('contacts.task.running', {
      current: displayTask.value?.processedSessions ?? 0,
      total: displayTask.value?.totalSessions ?? 0,
    })
  }
  return t('common.loading')
})
const showDisabledNotice = computed(() =>
  shouldShowContactsDisabledNotice({
    diagnostics: diagnostics.value,
    showLoadingState: showLoadingState.value,
  })
)

const stats = computed(() => {
  const responseStats = response.value?.stats
  const friends = responseStats?.friendsTotal ?? 0
  const nonFriends = responseStats?.nonFriendsTotal ?? 0
  return {
    total: friends + nonFriends,
    friends,
    nonFriends,
  }
})

const contactTabs = computed(() => [
  {
    id: 'friend',
    label: `${t('contacts.tabs.friends')} ${stats.value.friends.toLocaleString()}`,
    icon: 'i-heroicons-user',
  },
  {
    id: 'non_friend',
    label: `${t('contacts.tabs.groupContacts')} ${stats.value.nonFriends.toLocaleString()}`,
    icon: 'i-heroicons-user-group',
  },
])

const timeRangeTabs = computed(() =>
  CONTACTS_TIME_RANGE_PRESETS.map((preset) => ({
    label: t(`contacts.timeRange.${preset}`),
    value: preset,
  }))
)

const virtualizer = useVirtualizer(
  computed(() => ({
    count: virtualRows.value.length,
    getScrollElement: () => scrollContainerRef.value,
    estimateSize: (index: number) => estimateVirtualRowSize(virtualRows.value[index]),
    overscan: 10,
    getItemKey: (index: number) => virtualRows.value[index]?.key ?? index,
  }))
)

const virtualItems = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

watch(searchQuery, (value) => {
  if (searchTimer.value) clearTimeout(searchTimer.value)
  searchTimer.value = setTimeout(() => {
    debouncedSearchQuery.value = value.trim()
  }, 300)
})

watch(
  () => task.value?.status,
  () => syncContactsPolling()
)

watch(
  () => ({
    status: task.value?.status,
    processedSessions: task.value?.processedSessions ?? 0,
    totalSessions: task.value?.totalSessions ?? 0,
  }),
  (next, previous) => {
    if (next.status === 'running') clearCompletedContactsTaskProgress()
    if (!task.value) return
    if (
      shouldHoldCompletedContactsTaskProgress({
        previousStatus: previous?.status,
        nextStatus: next.status,
        previousProcessedSessions: previous?.processedSessions ?? 0,
        nextProcessedSessions: next.processedSessions,
        nextTotalSessions: next.totalSessions,
      })
    ) {
      holdCompletedContactsTaskProgress(task.value)
    }
  }
)

watch([debouncedSearchQuery, timeRangePreset], () => {
  resetContactsState()
  void loadInitialContactsPages()
})

watch(
  () => virtualRows.value.length,
  () => {
    virtualizer.value.measure()
  }
)

watch(
  virtualItems,
  () => {
    maybeLoadMoreContacts()
  },
  { flush: 'post' }
)

watch(virtualRows, () => {
  if (!selectedKey.value) return
  if (friendState.value.items.some((contact) => contact.key === selectedKey.value)) return
  if (groupmateState.value.items.some((contact) => contact.key === selectedKey.value)) return
  clearSelectedContact()
})

onMounted(() => {
  void loadInitialContactsPages()
})

onUnmounted(() => {
  stopContactsPolling()
  clearCompletedContactsTaskProgress()
  if (searchTimer.value) clearTimeout(searchTimer.value)
  if (tabNavigationTimer.value) clearTimeout(tabNavigationTimer.value)
})

async function loadFirstPage(pool: ContactPoolTab, options?: { acceptStale?: boolean; force?: boolean }) {
  const promise = loadContactsPage(pool, 1, { ...options, replace: true })
  firstPageLoads[pool] = promise
  try {
    await promise
  } finally {
    if (firstPageLoads[pool] === promise) firstPageLoads[pool] = null
  }
}

async function loadInitialContactsPages() {
  await Promise.all([loadFirstPage('friend'), loadFirstPage('non_friend')])
}

async function loadNextPageForPool(pool: ContactPoolTab) {
  const state = tabStates.value[pool]
  if (!state.hasMore || state.isLoadingInitial || state.isLoadingMore) return
  await loadContactsPage(pool, state.page + 1, { acceptStale: true, replace: false })
}

async function loadContactsPage(
  pool: ContactPoolTab,
  page: number,
  options?: {
    acceptStale?: boolean
    force?: boolean
    replace?: boolean
    preserveExisting?: boolean
    silent?: boolean
    throwOnError?: boolean
  }
) {
  const state = tabStates.value[pool]
  const replace = options?.replace !== false
  const requestId = state.requestId + 1
  state.requestId = requestId
  state.error = ''
  if (!options?.silent) {
    if (replace) state.isLoadingInitial = state.items.length === 0
    else state.isLoadingMore = true
  }

  try {
    const params = {
      acceptStale: options?.acceptStale,
      timeRangePreset: timeRangePreset.value,
      pool,
      page,
      pageSize: CONTACTS_PAGE_SIZE,
      query: debouncedSearchQuery.value || undefined,
    }
    const next = options?.force ? await dataService.recomputeContacts(params) : await dataService.getContacts(params)
    if (state.requestId !== requestId) return
    applyContactsPage(state, next, replace, { preserveExisting: options?.preserveExisting })
    syncContactsPolling()
  } catch (err) {
    if (state.requestId === requestId) state.error = String(err)
    if (options?.throwOnError) throw err
  } finally {
    if (state.requestId === requestId) {
      state.isLoadingInitial = false
      state.isLoadingMore = false
    }
  }
}

async function recomputeContacts() {
  isRecomputing.value = true
  try {
    await loadContactsPage(activeContactSection.value, 1, {
      acceptStale: true,
      force: true,
      replace: true,
      throwOnError: true,
    })
    toast.success(t('contacts.toast.recomputeStarted'))
  } catch (err) {
    toast.fail(t('contacts.toast.recomputeFailed'), { description: String(err) })
  } finally {
    isRecomputing.value = false
  }
}

function applyContactsPage(
  state: ContactsTabState,
  next: ContactsResponse,
  replace: boolean,
  options?: { preserveExisting?: boolean }
) {
  const previousSignature = state.response?.cache.signature
  const nextSignature = next.cache.signature
  const signatureChanged = !!previousSignature && !!nextSignature && previousSignature !== nextSignature
  state.response = next
  state.total = next.pagination.total
  if (options?.preserveExisting && !signatureChanged && state.items.length > 0) {
    state.hasMore = state.items.length < next.pagination.total
    return
  }
  state.page = next.pagination.page
  state.hasMore = next.pagination.hasMore
  state.items = replace || signatureChanged ? next.contacts : mergeContacts(state.items, next.contacts)
  if (signatureChanged) clearSelectedContact()
}

function mergeContacts(existing: ContactListItem[], next: ContactListItem[]): ContactListItem[] {
  const seen = new Set(existing.map((contact) => contact.key))
  const merged = [...existing]
  for (const contact of next) {
    if (seen.has(contact.key)) continue
    seen.add(contact.key)
    merged.push(contact)
  }
  return merged
}

function maybeLoadMoreContacts() {
  const items = virtualItems.value
  const lastItem = items.at(-1)
  if (!lastItem) return
  if (lastItem.index < virtualRows.value.length - CONTACTS_LOAD_MORE_REMAINING) return

  const row = rowAt(lastItem.index)
  if (row.pool === 'friend') {
    if (friendState.value.hasMore) {
      void loadNextPageForPool('friend')
      return
    }
    if (
      friendSectionReadyForGroupmates.value &&
      !groupmateState.value.response &&
      !groupmateState.value.isLoadingInitial
    ) {
      void loadFirstPage('non_friend')
    }
    return
  }

  if (!groupmateState.value.response && !groupmateState.value.isLoadingInitial) {
    void loadFirstPage('non_friend')
    return
  }
  if (groupmateState.value.hasMore) {
    void loadNextPageForPool('non_friend')
  }
}

function rowAt(index: number): ContactVirtualRow {
  return virtualRows.value[index]!
}

function contactRowAt(index: number): Extract<ContactVirtualRow, { type: 'contact' }> {
  return rowAt(index) as Extract<ContactVirtualRow, { type: 'contact' }>
}

function estimateVirtualRowSize(row: ContactVirtualRow | undefined): number {
  if (row?.type === 'section') return row.pool === 'non_friend' ? 42 : 1
  if (row?.type === 'loading') return 44
  return CONTACTS_ROW_ESTIMATE
}

async function handleContactTabChange(pool: string) {
  const targetPool = pool === 'non_friend' ? 'non_friend' : 'friend'
  activeContactSection.value = targetPool
  isTabNavigationScrolling.value = true
  if (tabNavigationTimer.value) clearTimeout(tabNavigationTimer.value)
  if (targetPool === 'non_friend') await ensureGroupmateSectionVisible()
  await nextTick()
  const targetIndex = virtualRows.value.findIndex((row) => row.type === 'section' && row.pool === targetPool)
  if (targetIndex >= 0) {
    const scrollIndex =
      targetPool === 'non_friend' ? Math.min(targetIndex + 1, virtualRows.value.length - 1) : targetIndex
    virtualizer.value.scrollToIndex(scrollIndex, { align: 'start' })
  }
  tabNavigationTimer.value = setTimeout(() => {
    isTabNavigationScrolling.value = false
    activeContactSection.value = targetPool
  }, 350)
}

async function ensureGroupmateSectionVisible() {
  if (!groupmateState.value.response && !groupmateState.value.isLoadingInitial) {
    await loadFirstPage('non_friend', { acceptStale: true })
  }
  await waitForStableContactNavigationRows('non_friend')
}

async function waitForStableContactNavigationRows(targetPool: ContactPoolTab) {
  if (
    !shouldWaitForStableContactNavigationRows({
      targetPool,
      friendInitialLoading: friendState.value.isLoadingInitial,
      groupmateInitialLoading: groupmateState.value.isLoadingInitial,
    })
  ) {
    return
  }

  const pendingLoads = [firstPageLoads.friend, firstPageLoads.non_friend].filter(
    (promise): promise is Promise<void> => !!promise
  )
  if (pendingLoads.length === 0) return
  await Promise.allSettled(pendingLoads)
}

function resetContactsState() {
  isTabNavigationScrolling.value = false
  if (tabNavigationTimer.value) clearTimeout(tabNavigationTimer.value)
  clearCompletedContactsTaskProgress()
  for (const pool of ['friend', 'non_friend'] as const) {
    tabStates.value[pool].requestId++
    tabStates.value[pool] = createTabState()
  }
  clearSelectedContact()
  detailCache.value = {}
  if (scrollContainerRef.value) scrollContainerRef.value.scrollTop = 0
}

function syncContactsPolling() {
  if (isTaskRunning.value) {
    startContactsPolling()
  } else {
    stopContactsPolling()
  }
}

function startContactsPolling() {
  if (pollTimer.value) return
  pollTimer.value = setInterval(() => {
    void pollContactsPages()
  }, 1500)
}

async function pollContactsPages() {
  if (isPollingContacts.value) return
  isPollingContacts.value = true
  try {
    const pools = resolveContactsPollingPools({
      activePool: activeContactSection.value,
      friendTaskStatus: friendState.value.response?.task?.status,
      groupmateTaskStatus: groupmateState.value.response?.task?.status,
    })
    await Promise.all(
      pools.map((pool) =>
        loadContactsPage(pool, 1, {
          acceptStale: true,
          replace: true,
          preserveExisting: true,
          silent: true,
        })
      )
    )
  } finally {
    isPollingContacts.value = false
  }
}

function stopContactsPolling() {
  if (!pollTimer.value) return
  clearInterval(pollTimer.value)
  pollTimer.value = null
}

function holdCompletedContactsTaskProgress(nextTask: ContactsTaskState) {
  clearCompletedContactsTaskProgress()
  completedTaskForDisplay.value = {
    ...nextTask,
    processedSessions: nextTask.totalSessions,
  }
  completedTaskDisplayTimer.value = setTimeout(() => {
    completedTaskForDisplay.value = null
    completedTaskDisplayTimer.value = null
  }, 450)
}

function clearCompletedContactsTaskProgress() {
  if (completedTaskDisplayTimer.value) {
    clearTimeout(completedTaskDisplayTimer.value)
    completedTaskDisplayTimer.value = null
  }
  completedTaskForDisplay.value = null
}

async function selectContact(contact: ContactListItem) {
  selectedKey.value = contact.key
  await loadSelectedContactDetail(contact.key)
}

async function loadSelectedContactDetail(key: string, options?: { skipCache?: boolean }) {
  const cacheKey = `${timeRangePreset.value}:${key}`
  const cached = detailCache.value[cacheKey]
  if (cached && !options?.skipCache) {
    selectedContact.value = cached
    return
  }

  selectedContact.value = null
  isDetailLoading.value = true
  try {
    const detail = await dataService.getContactDetail(key, {
      acceptStale: true,
      timeRangePreset: timeRangePreset.value,
    })
    if (selectedKey.value !== key) return
    selectedContact.value = detail.contact
    if (detail.contact) {
      detailCache.value = {
        ...detailCache.value,
        [cacheKey]: detail.contact,
      }
    }
  } catch (err) {
    toast.fail(t('contacts.toast.recomputeFailed'), { description: String(err) })
  } finally {
    if (selectedKey.value === key) isDetailLoading.value = false
  }
}

async function markSelectedContactAsFriend() {
  const key = selectedContact.value?.key
  if (!key || isFriendActionSaving.value) return
  isFriendActionSaving.value = true
  try {
    await dataService.markContactAsFriend(key, { timeRangePreset: timeRangePreset.value })
    toast.success(t('contacts.toast.markFriendSucceeded'))
    await refreshContactsAfterFriendAction(key)
  } catch (err) {
    toast.fail(t('contacts.toast.markFriendFailed'), { description: String(err) })
  } finally {
    isFriendActionSaving.value = false
  }
}

async function unmarkSelectedContactAsFriend() {
  const key = selectedContact.value?.key
  if (!key || isFriendActionSaving.value) return
  isFriendActionSaving.value = true
  try {
    await dataService.unmarkContactAsFriend(key, { timeRangePreset: timeRangePreset.value })
    toast.success(t('contacts.toast.unmarkFriendSucceeded'))
    await refreshContactsAfterFriendAction(key)
  } catch (err) {
    toast.fail(t('contacts.toast.unmarkFriendFailed'), { description: String(err) })
  } finally {
    isFriendActionSaving.value = false
  }
}

async function refreshContactsAfterFriendAction(key: string) {
  const previousSection = activeContactSection.value
  const previousScrollTop = scrollContainerRef.value?.scrollTop ?? 0
  const previousPool = selectedContact.value?.pool ?? previousSection
  detailCache.value = {}
  if (previousPool === 'non_friend') {
    removeContactFromGroupmateList(key)
    clearSelectedContact()
    await restoreFriendActionScroll(previousSection, previousScrollTop)
    await refreshContactsPageMetadata()
    return
  }

  await Promise.all([
    loadFirstPage('friend', { acceptStale: true }),
    loadFirstPage('non_friend', { acceptStale: true }),
  ])
  selectedKey.value = key
  await loadSelectedContactDetail(key, { skipCache: true })
  await restoreFriendActionScroll(previousSection, previousScrollTop)
}

function removeContactFromGroupmateList(key: string) {
  const state = groupmateState.value
  const nextItems = state.items.filter((contact) => contact.key !== key)
  if (nextItems.length === state.items.length) return
  state.items = nextItems
  state.total = Math.max(0, state.total - 1)
  state.hasMore = state.items.length < state.total
}

async function refreshContactsPageMetadata() {
  await Promise.all([
    loadContactsPage('friend', 1, {
      acceptStale: true,
      replace: true,
      preserveExisting: shouldPreserveFriendActionRefreshRows('friend'),
      silent: true,
    }),
    loadContactsPage('non_friend', 1, {
      acceptStale: true,
      replace: true,
      preserveExisting: shouldPreserveFriendActionRefreshRows('non_friend'),
      silent: true,
    }),
  ])
}

function clearSelectedContact() {
  selectedKey.value = null
  selectedContact.value = null
  isDetailLoading.value = false
}

function contactBadgeLabel(contact: ContactListItem): string {
  if (contact.friendSource === 'manual') return t('contacts.pool.manualFriend')
  if (contact.pool === 'friend') return t('contacts.pool.friend')
  return t('contacts.pool.nonFriend')
}

function contactBadgeClasses(contact: ContactListItem): string {
  if (contact.friendSource === 'manual') {
    return 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400 border border-indigo-100/50 dark:border-indigo-500/20'
  }
  if (contact.pool === 'friend') {
    return 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400 border border-sky-100/50 dark:border-sky-500/20'
  }
  return 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 border border-emerald-100/50 dark:border-emerald-500/20'
}

function contactGridClass(pool: ContactPoolTab): string {
  return pool === 'friend' ? 'contact-table-grid--friends' : 'contact-table-grid--group-contacts'
}

function contactFirstMetric(pool: ContactPoolTab, contact: ContactListItem): string {
  return pool === 'friend'
    ? formatCount(contact.scoreBreakdown.privateMessageCount)
    : formatCount(contact.scoreBreakdown.commonGroupCount)
}

function contactSecondMetric(pool: ContactPoolTab, contact: ContactListItem): string {
  return pool === 'friend'
    ? formatCount(contact.scoreBreakdown.activePrivateMonths)
    : formatCount(contact.scoreBreakdown.coOccurrenceCount)
}

function contactThirdMetric(pool: ContactPoolTab, contact: ContactListItem): string {
  return pool === 'friend'
    ? formatCount(contact.scoreBreakdown.commonGroupCount)
    : formatCount(contact.scoreBreakdown.replyInteractionCount)
}

function avatarText(contact: ContactListItem | ContactItem): string {
  return (contact.displayName || contact.platformId || '?').slice(0, 1)
}

function formatScore(score: number): string {
  return Math.round(score * 100).toString()
}

function formatContactScore(contact: ContactListItem): string {
  if (contact.friendSource === 'manual') return '-'
  return formatScore(contact.score)
}

function formatCount(value: number | undefined): string {
  return String(value ?? 0)
}

function formatTime(ts: number | null | undefined): string {
  if (!ts) return t('contacts.emptyValue')
  return new Date(ts * 1000).toLocaleDateString()
}

function openSourceSession(source: ContactItem['sourceSessions'][number]) {
  router.push({
    name: source.type === 'private' ? 'private-chat' : 'group-chat',
    params: { id: source.id },
  })
}

function viewSourceSessionRecords(source: ContactItem['sourceSessions'][number]) {
  layoutStore.openChatRecordDrawer({ sessionId: source.id })
}

function handleListScroll(event: Event) {
  const target = event.target as HTMLElement
  activeState.value.scrollOffset = target.scrollTop
  if (isTabNavigationScrolling.value) return
  const pool = getPoolAtScrollPosition(target)
  if (activeContactSection.value !== pool) activeContactSection.value = pool
}

function handleTableHorizontalScroll(event: Event) {
  tableScrollLeft.value = (event.target as HTMLElement).scrollLeft
}

function getPoolAtScrollPosition(scrollElement: HTMLElement): ContactPoolTab {
  if (!showGroupSection.value || !tableBodyRef.value) return 'friend'
  const stickyHeaderHeight = 42
  return scrollElement.scrollTop + stickyHeaderHeight >= tableBodyRef.value.offsetTop + getGroupSectionStart()
    ? 'non_friend'
    : 'friend'
}

function getGroupSectionStart(): number {
  return 1 + friendState.value.items.length * CONTACTS_ROW_ESTIMATE + (friendState.value.isLoadingMore ? 44 : 0)
}

async function restoreFriendActionScroll(previousSection: ContactPoolTab, previousScrollTop: number) {
  activeContactSection.value = previousSection
  await nextTick()
  const scrollElement = scrollContainerRef.value
  if (!scrollElement) return

  isTabNavigationScrolling.value = true
  if (tabNavigationTimer.value) clearTimeout(tabNavigationTimer.value)
  scrollElement.scrollTop = resolveFriendActionScrollTop({
    activeSection: previousSection,
    previousScrollTop,
    groupSectionScrollTop: getGroupSectionScrollTop(),
  })
  tabNavigationTimer.value = setTimeout(() => {
    isTabNavigationScrolling.value = false
    activeContactSection.value = previousSection
  }, 150)
}

function getGroupSectionScrollTop(): number | null {
  if (!showGroupSection.value || !tableBodyRef.value) return null
  const stickyHeaderHeight = 42
  return tableBodyRef.value.offsetTop + getGroupSectionStart() - stickyHeaderHeight
}
</script>

<template>
  <div
    class="flex h-full flex-col bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100"
    style="padding-top: var(--titlebar-area-height)"
  >
    <PageHeader
      :title="t('layout.relationships')"
      :description="t('contacts.subtitle', { count: diagnostics?.privateSessionCount ?? 0 })"
      size="compact"
      icon="i-lucide-users"
      icon-class="bg-primary-600 text-white dark:bg-primary-500 dark:text-white shadow-sm"
    >
      <template #actions>
        <UButton
          icon="i-lucide-refresh-cw"
          color="primary"
          variant="soft"
          size="sm"
          class="rounded-xl border border-pink-100 hover:border-pink-200 dark:border-pink-950/30 dark:hover:border-pink-900/50"
          :loading="isRecomputing"
          :disabled="isTaskRunning"
          @click="recomputeContacts"
        >
          {{ t('contacts.actions.recompute') }}
        </UButton>
      </template>

      <div class="mt-3 flex items-center justify-between gap-3 pb-1.5">
        <PeopleSubnav active="contacts" />

        <!-- 统计指标面板 -->
        <div class="hidden items-center gap-5 text-[11px] sm:flex">
          <div class="flex items-center gap-1.5">
            <span class="text-gray-400 dark:text-gray-500">{{ t('contacts.stats.total') }}</span>
            <span class="font-mono font-bold text-gray-900 dark:text-white">{{ stats.total }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="text-gray-400 dark:text-gray-500">{{ t('contacts.stats.friends') }}</span>
            <span class="font-mono font-bold text-gray-900 dark:text-white">{{ stats.friends }}</span>
          </div>
          <div class="h-3 w-px bg-gray-250 dark:bg-white/10"></div>
          <div class="flex items-center gap-1.5">
            <span class="text-gray-400 dark:text-gray-500">{{ t('contacts.stats.nonFriends') }}</span>
            <span class="font-mono font-bold text-gray-900 dark:text-white">{{ stats.nonFriends }}</span>
          </div>
        </div>
      </div>
    </PageHeader>

    <div class="flex min-h-0 flex-1 flex-col">
      <SubTabs
        v-model="activeContactSection"
        :items="contactTabs"
        persist-key="contactsTab"
        @change="handleContactTabChange"
      >
        <template #right>
          <div class="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 px-3 py-2 lg:px-0 lg:py-0">
            <UTabs
              v-model="timeRangePreset"
              :items="timeRangeTabs"
              :content="false"
              size="xs"
              class="min-w-max gap-0"
              :disabled="isTaskRunning"
            />
            <UInput
              v-model="searchQuery"
              icon="i-lucide-search"
              :placeholder="t('contacts.search')"
              size="sm"
              class="w-full sm:w-32"
            >
              <template v-if="searchQuery" #trailing>
                <UButton
                  icon="i-heroicons-x-mark"
                  variant="link"
                  color="neutral"
                  size="xs"
                  :aria-label="t('contacts.actions.clearSearch')"
                  @click="searchQuery = ''"
                />
              </template>
            </UInput>
          </div>
        </template>
      </SubTabs>

      <div class="flex min-h-0 flex-1 overflow-hidden">
        <main ref="scrollContainerRef" class="min-h-0 min-w-0 flex-1 overflow-y-auto" @scroll="handleListScroll">
          <div class="mx-auto flex w-full max-w-[1800px] flex-col gap-6 px-6 pb-6 pt-0 lg:px-8">
            <ContactsStatusBlocks
              :show-disabled-notice="showDisabledNotice"
              :active-private-session-count="diagnostics?.activePrivateSessionCount ?? 0"
              :cache-status="response?.cache.status"
              :task-failed="taskFailed"
              :task-last-error="task?.lastError"
              :is-task-running="isTaskRunning"
              :is-recomputing="isRecomputing"
              @recompute="recomputeContacts"
            />

            <section class="flex flex-col gap-4">
              <LoadingState v-if="showLoadingState" :text="loadingStateText" height="py-16" />

              <div
                v-else-if="pageError"
                class="rounded-2xl border border-red-200 bg-red-50/50 p-4 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-300"
              >
                {{ pageError }}
              </div>

              <div v-else class="min-h-0">
                <div
                  v-if="showEmptyState"
                  class="flex flex-col items-center justify-center rounded-3xl border border-dashed border-gray-250 p-16 text-center dark:border-white/5"
                >
                  <div
                    class="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-50 text-gray-400 dark:bg-white/5 dark:text-gray-500"
                  >
                    <UIcon name="i-lucide-users-2" class="h-6 w-6" />
                  </div>
                  <p class="mt-4 text-sm font-medium text-gray-400 dark:text-gray-500">{{ t('contacts.empty') }}</p>
                </div>

                <div v-else class="min-w-0">
                  <div
                    class="sticky top-0 z-20 overflow-hidden border-b border-gray-100 bg-white dark:border-gray-800/40 dark:bg-gray-900"
                  >
                    <div
                      class="contact-table-grid min-w-[720px] px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500"
                      :class="contactGridClass(activeContactSection)"
                      :style="{ transform: `translateX(-${tableScrollLeft}px)` }"
                    >
                      <span>{{ t('contacts.table.contact') }}</span>
                      <span>{{ t('contacts.table.status') }}</span>
                      <template v-if="activeContactSection === 'friend'">
                        <span>{{ t('contacts.metrics.privateMessagesLabel') }}</span>
                        <span>{{ t('contacts.metrics.activeMonths') }}</span>
                        <span>{{ t('contacts.metrics.commonGroups') }}</span>
                      </template>
                      <template v-else>
                        <span>{{ t('contacts.metrics.commonGroups') }}</span>
                        <span>{{ t('contacts.metrics.coOccurrence') }}</span>
                        <span>{{ t('contacts.metrics.replies') }}</span>
                      </template>
                      <span>{{ t('contacts.metrics.lastInteractionShort') }}</span>
                      <span class="flex min-w-0 items-center justify-end gap-1 text-right">
                        <span class="truncate">{{ t('contacts.detail.score') }}</span>
                        <UTooltip :content="{ side: 'top' }" :ui="{ content: 'h-auto' }">
                          <UIcon
                            name="i-lucide-circle-help"
                            class="h-3.5 w-3.5 shrink-0 text-gray-350 transition-colors hover:text-primary-500 dark:text-gray-600 dark:hover:text-primary-400"
                          />
                          <template #content>
                            <div class="max-w-[280px] whitespace-normal break-words text-left text-xs leading-5">
                              {{ t('contacts.detail.scoreHelp') }}
                            </div>
                          </template>
                        </UTooltip>
                      </span>
                    </div>
                  </div>

                  <div ref="tableBodyRef" class="overflow-x-auto scrollbar-hide" @scroll="handleTableHorizontalScroll">
                    <div class="relative min-w-[720px]" :style="{ height: `${totalSize}px` }">
                      <template v-for="virtualRow in virtualItems" :key="String(virtualRow.key)">
                        <div
                          v-if="rowAt(virtualRow.index).type === 'section' && rowAt(virtualRow.index).pool === 'friend'"
                          class="absolute left-0 top-0 h-px w-full"
                          :style="{ transform: `translateY(${virtualRow.start}px)` }"
                          aria-hidden="true"
                        ></div>

                        <div
                          v-else-if="rowAt(virtualRow.index).type === 'section'"
                          class="contact-table-grid absolute left-0 top-0 w-full border-b border-gray-100 bg-white px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:border-gray-800/40 dark:bg-gray-900 dark:text-gray-500"
                          :class="contactGridClass(rowAt(virtualRow.index).pool)"
                          :style="{ transform: `translateY(${virtualRow.start}px)` }"
                        >
                          <span>{{ t('contacts.table.contact') }}</span>
                          <span>{{ t('contacts.table.status') }}</span>
                          <span>{{ t('contacts.metrics.commonGroups') }}</span>
                          <span>{{ t('contacts.metrics.coOccurrence') }}</span>
                          <span>{{ t('contacts.metrics.replies') }}</span>
                          <span>{{ t('contacts.metrics.lastInteractionShort') }}</span>
                          <span class="flex min-w-0 items-center justify-end gap-1 text-right">
                            <span class="truncate">{{ t('contacts.detail.score') }}</span>
                            <UTooltip :content="{ side: 'top' }" :ui="{ content: 'h-auto' }">
                              <UIcon
                                name="i-lucide-circle-help"
                                class="h-3.5 w-3.5 shrink-0 text-gray-350 transition-colors hover:text-primary-500 dark:text-gray-600 dark:hover:text-primary-400"
                              />
                              <template #content>
                                <div class="max-w-[280px] whitespace-normal break-words text-left text-xs leading-5">
                                  {{ t('contacts.detail.scoreHelp') }}
                                </div>
                              </template>
                            </UTooltip>
                          </span>
                        </div>

                        <button
                          v-else-if="rowAt(virtualRow.index).type === 'contact'"
                          type="button"
                          class="contact-table-grid absolute left-0 top-0 w-full px-4 py-3.5 text-left outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                          :class="[
                            contactGridClass(contactRowAt(virtualRow.index).pool),
                            selectedKey === contactRowAt(virtualRow.index).contact.key
                              ? 'border-b border-primary-500/20 bg-primary-500/[0.03] dark:bg-primary-500/[0.04]'
                              : 'border-b border-gray-100/50 bg-transparent hover:bg-gray-50/50 dark:border-white/5 dark:hover:bg-gray-800/20',
                          ]"
                          :style="{ transform: `translateY(${virtualRow.start}px)` }"
                          :aria-label="
                            t('contacts.actions.viewDetail', {
                              name: contactRowAt(virtualRow.index).contact.displayName,
                            })
                          "
                          @click="selectContact(contactRowAt(virtualRow.index).contact)"
                        >
                          <div
                            class="absolute left-0 top-1/4 h-1/2 w-1 rounded-r-full bg-primary-500 transition-all duration-300"
                            :class="
                              selectedKey === contactRowAt(virtualRow.index).contact.key
                                ? 'scale-100 opacity-100'
                                : 'scale-75 opacity-0'
                            "
                          ></div>

                          <div class="group flex min-w-0 w-full items-center gap-3">
                            <div class="relative shrink-0 overflow-hidden rounded-lg">
                              <img
                                v-if="contactRowAt(virtualRow.index).contact.avatar"
                                :src="contactRowAt(virtualRow.index).contact.avatar ?? ''"
                                :alt="contactRowAt(virtualRow.index).contact.displayName"
                                loading="lazy"
                                decoding="async"
                                class="h-10 w-10 object-cover transition-transform duration-300 group-hover:scale-105"
                              />
                              <div
                                v-else
                                class="flex h-10 w-10 items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 text-sm font-bold text-gray-500 transition-transform duration-300 group-hover:scale-105 dark:from-gray-800 dark:to-gray-800/60 dark:text-gray-400"
                              >
                                {{ avatarText(contactRowAt(virtualRow.index).contact) }}
                              </div>
                            </div>

                            <div class="min-w-0 flex-1">
                              <div class="flex min-w-0 items-center gap-1">
                                <span
                                  class="truncate text-sm font-semibold leading-tight tracking-tight text-gray-800 transition-colors group-hover:text-primary-600 group-focus-visible:text-primary-600 dark:text-gray-200 dark:group-hover:text-primary-400 dark:group-focus-visible:text-primary-400"
                                  :class="
                                    selectedKey === contactRowAt(virtualRow.index).contact.key
                                      ? 'text-primary-600 dark:text-primary-400'
                                      : ''
                                  "
                                >
                                  {{ contactRowAt(virtualRow.index).contact.displayName }}
                                </span>
                              </div>
                              <span
                                class="mt-1 inline-flex items-center rounded bg-gray-50 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-gray-400 dark:bg-white/5 dark:text-gray-500"
                              >
                                {{ contactRowAt(virtualRow.index).contact.platform }}
                              </span>
                            </div>
                          </div>

                          <span
                            class="inline-flex w-fit justify-self-start rounded-lg px-2.5 py-1 text-xs font-semibold"
                            :class="contactBadgeClasses(contactRowAt(virtualRow.index).contact)"
                          >
                            {{ contactBadgeLabel(contactRowAt(virtualRow.index).contact) }}
                          </span>

                          <span class="contact-table-value">
                            {{
                              contactFirstMetric(
                                contactRowAt(virtualRow.index).pool,
                                contactRowAt(virtualRow.index).contact
                              )
                            }}
                          </span>
                          <span class="contact-table-value">
                            {{
                              contactSecondMetric(
                                contactRowAt(virtualRow.index).pool,
                                contactRowAt(virtualRow.index).contact
                              )
                            }}
                          </span>
                          <span class="contact-table-value">
                            {{
                              contactThirdMetric(
                                contactRowAt(virtualRow.index).pool,
                                contactRowAt(virtualRow.index).contact
                              )
                            }}
                          </span>
                          <span class="contact-table-value">
                            {{ formatTime(contactRowAt(virtualRow.index).contact.lastInteractionTs) }}
                          </span>
                          <span
                            class="inline-flex h-7 w-12 items-center justify-center justify-self-end rounded-lg font-mono text-xs font-bold tabular-nums transition-colors duration-200"
                            :class="
                              selectedKey === contactRowAt(virtualRow.index).contact.key
                                ? 'bg-primary-500 text-white'
                                : 'bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400'
                            "
                          >
                            {{ formatContactScore(contactRowAt(virtualRow.index).contact) }}
                          </span>
                        </button>

                        <div
                          v-else
                          class="absolute left-0 top-0 flex h-11 w-full items-center justify-center gap-2 border-b border-gray-100/50 text-xs font-semibold text-gray-500 dark:border-white/5 dark:text-gray-400"
                          :style="{ transform: `translateY(${virtualRow.start}px)` }"
                        >
                          <UIcon name="i-lucide-loader-2" class="h-4 w-4 animate-spin" />
                          <span>{{ t('common.loading') }}</span>
                        </div>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </main>

        <ContactDetailPanel
          :selected-key="selectedKey"
          :contact="selectedContact"
          :is-loading="isDetailLoading"
          :is-friend-action-loading="isFriendActionSaving"
          @clear="clearSelectedContact"
          @open-source="openSourceSession"
          @view-source-records="viewSourceSessionRecords"
          @mark-friend="markSelectedContactAsFriend"
          @unmark-friend="unmarkSelectedContactAsFriend"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.contact-table-grid {
  display: grid;
  align-items: center;
  column-gap: 12px;
  min-width: 0;
}

.contact-table-grid--friends,
.contact-table-grid--group-contacts {
  grid-template-columns: minmax(180px, 1.5fr) 118px 86px 86px 86px 104px 54px;
}

.contact-table-grid > * {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-table-value {
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgb(75, 85, 99);
}

.dark .contact-table-value {
  color: rgb(209, 213, 219);
}
</style>
