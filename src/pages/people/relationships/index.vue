<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CONTACTS_TIME_RANGE_PRESETS } from '@openchatlab/shared-types'
import type {
  ContactsTimeRangePreset,
  PeopleRelationshipGraphNode,
  PeopleRelationshipsGraphData,
  PeopleRelationshipsGraphScope,
  PeopleRelationshipsGraphResponse,
  PeopleRelationshipsNeighborhoodResponse,
  PeopleRelationshipsSearchResult,
  PeopleRelationshipsTaskState,
} from '@openchatlab/shared-types'
import { useDataService } from '@/services'
import { useToast } from '@/composables/useToast'
import { LoadingState } from '@/components/UI'
import LazyAvatar from '@/components/common/avatar/LazyAvatar.vue'
import { usePeoplePageHeader } from '../people-page-header'
import { buildRelationshipConnectionRanking, RELATED_CONTACTS_VISIBLE_LIMIT } from './relationship-galaxy-connections'
import { resolveRelationshipGalaxyCanvasSelectedKey } from './relationship-galaxy-selection'
import {
  resolveRelationshipGalaxyActiveTask,
  resolveRelationshipGalaxyEmptyText,
  resolveRelationshipGalaxyPollingAction,
  shouldShowFocusConnectionsAction,
} from './relationship-galaxy-state'
import { maskRelationshipGalaxyPrivateText, relationshipGalaxyPrivateAvatarText } from './relationship-galaxy-privacy'

type GalaxyCanvasInstance = {
  focusNode: (key: string) => boolean
  fitView: () => void
  captureView: () => unknown | null
  restoreView: (view: unknown) => boolean
}
type GalaxyViewMode = '3d' | '2d'
type RelationshipGraphResponseWithGraph = Pick<
  PeopleRelationshipsGraphResponse,
  'algorithmVersion' | 'cache' | 'timeRange' | 'graph'
>

const EMPTY_GRAPH: PeopleRelationshipsGraphData = {
  nodes: [],
  edges: [],
  communities: [],
}

const POLL_INTERVAL_MS = 1400
const RELATIONSHIP_DETAIL_PANEL_SAFE_INSET_RIGHT = 392
const RelationshipGalaxyThreeCanvas = defineAsyncComponent(
  () => import('./components/RelationshipGalaxyThreeCanvas.vue')
)
const RelationshipGalaxyCanvas = defineAsyncComponent(() => import('./components/RelationshipGalaxyCanvas.vue'))

const { t, locale } = useI18n()
const dataService = useDataService()
const toast = useToast()

const timeRangePreset = ref<ContactsTimeRangePreset>('1y')
const graphScope = ref<PeopleRelationshipsGraphScope>('panorama')
const searchQuery = ref('')
const debouncedSearchQuery = ref('')
const isSearchResultsOpen = ref(false)
const searchResultsQuery = ref('')
const selectedKey = ref<string | null>(null)
const isDetailPanelOpen = ref(false)
const graphResponse = ref<PeopleRelationshipsGraphResponse | null>(null)
const neighborhoodResponse = ref<PeopleRelationshipsNeighborhoodResponse | null>(null)
const isLoading = ref(false)
const isRecomputing = ref(false)
const isLoadingNeighborhood = ref(false)
const isDetailSidePanelLayout = ref(false)
const loadingNeighborhoodKey = ref<string | null>(null)
const canvasSelectedKey = ref<string | null>(null)
const privacyMode = ref(false)
const viewMode = ref<GalaxyViewMode>('3d')
const loadError = ref('')
const graphRequestId = ref(0)
const neighborhoodRequestId = ref(0)
const canvasRef = ref<GalaxyCanvasInstance | null>(null)
const savedPanoramaView = ref<unknown | null>(null)

let graphContentKey: string | null = null
let neighborhoodGraphContentKey: string | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null
let detailPanelMediaQuery: MediaQueryList | null = null
let isRestoringPanoramaView = false

const numberFormatter = computed(() => new Intl.NumberFormat(locale.value))

const timeRangeTabs = computed(() =>
  CONTACTS_TIME_RANGE_PRESETS.map((preset) => ({
    label: t(`relationships.timeRange.${preset}`),
    value: preset,
  }))
)
const graphScopeTabs = computed(() => [
  {
    label: t('relationships.graphScope.panorama'),
    value: 'panorama' as const,
  },
  {
    label: t('relationships.graphScope.close'),
    value: 'close' as const,
  },
  {
    label: t('relationships.graphScope.friends'),
    value: 'friends' as const,
  },
])

const activeGraph = computed(() => neighborhoodResponse.value?.graph ?? graphResponse.value?.graph ?? EMPTY_GRAPH)
const isNeighborhoodMode = computed(() => Boolean(neighborhoodResponse.value))
const hasGraph = computed(() => activeGraph.value.nodes.length > 0)
const task = computed(() =>
  resolveRelationshipGalaxyActiveTask({
    graphTask: graphResponse.value?.task ?? null,
    neighborhoodTask: neighborhoodResponse.value?.task ?? null,
    isNeighborhoodMode: isNeighborhoodMode.value,
  })
)
const isTaskRunning = computed(() => task.value?.status === 'running')
const isTaskFailed = computed(() => task.value?.status === 'failed')
const cacheStatus = computed(() => graphResponse.value?.cache.status ?? neighborhoodResponse.value?.cache.status)
const searchResults = computed(() => graphResponse.value?.searchResults ?? [])
const hasSearchQuery = computed(() => searchQuery.value.trim().length > 0)
const showSearchResults = computed(
  () =>
    hasSearchQuery.value &&
    searchQuery.value.trim() === searchResultsQuery.value &&
    isSearchResultsOpen.value &&
    searchResults.value.length > 0
)
const showInitialLoading = computed(() => (isLoading.value || isTaskRunning.value) && !hasGraph.value)
const showUpdatingBanner = computed(() => isTaskRunning.value && hasGraph.value)
const selectedNode = computed(() => {
  if (!selectedKey.value) return null
  return (
    activeGraph.value.nodes.find((node) => node.key === selectedKey.value) ??
    neighborhoodResponse.value?.contact ??
    null
  )
})
const showDetailPanel = computed(() => isDetailPanelOpen.value && Boolean(selectedNode.value))
const detailPanelSafeInsetRight = computed(() =>
  showDetailPanel.value && isDetailSidePanelLayout.value ? RELATIONSHIP_DETAIL_PANEL_SAFE_INSET_RIGHT : 0
)
const showFocusConnectionsAction = computed(() =>
  shouldShowFocusConnectionsAction({
    selectedKey: selectedKey.value,
    isNeighborhoodMode: isNeighborhoodMode.value,
    neighborhoodContactKey: neighborhoodResponse.value?.contact?.key ?? null,
  })
)
const connectionRanking = computed(() =>
  buildRelationshipConnectionRanking(activeGraph.value, selectedKey.value, {
    collapsedLimit: RELATED_CONTACTS_VISIBLE_LIMIT,
  })
)

const stats = computed(() => ({
  nodes: activeGraph.value.nodes.length,
  edges: activeGraph.value.edges.length,
  communities: activeGraph.value.communities.length,
}))

const topCommunities = computed(() => [...activeGraph.value.communities].sort((a, b) => b.size - a.size).slice(0, 8))

const statusText = computed(() => {
  if (cacheStatus.value === 'stale' && isTaskRunning.value) return t('relationships.task.updating')
  if (isTaskRunning.value) return formatTaskProgress(task.value)
  if (isTaskFailed.value) return task.value?.lastError || t('relationships.task.failed')
  return ''
})
const emptyStateText = computed(() =>
  resolveRelationshipGalaxyEmptyText({
    loadError: loadError.value,
    isTaskFailed: isTaskFailed.value,
    statusText: statusText.value,
    emptyText: t('relationships.empty'),
  })
)

function formatNumber(value: number): string {
  return numberFormatter.value.format(value)
}

function formatScore(score: number): string {
  return Math.round(score * 100).toString()
}

function formatConnectionRankingCount(): string {
  const visible = connectionRanking.value.items.length
  const total = connectionRanking.value.total
  if (total <= visible) return formatNumber(total)
  return `${formatNumber(visible)} / ${formatNumber(total)}`
}

function formatTime(ts: number | null | undefined): string {
  if (!ts) return t('relationships.detail.emptyValue')
  return new Date(ts * 1000).toLocaleDateString()
}

function avatarText(node: PeopleRelationshipGraphNode | PeopleRelationshipsSearchResult): string {
  if (node.kind === 'owner') return t('relationships.owner.avatarText')
  if (privacyMode.value) return relationshipGalaxyPrivateAvatarText()
  return (node.displayName || node.platformId || '?').slice(0, 1)
}

function avatarSrc(node: PeopleRelationshipGraphNode | PeopleRelationshipsSearchResult): string | null {
  if (node.kind === 'owner') return node.avatar
  return privacyMode.value ? null : node.avatar
}

function displayName(node: PeopleRelationshipGraphNode | PeopleRelationshipsSearchResult): string {
  if (node.kind === 'owner') return t('relationships.owner.me')
  const name = node.displayName || node.platformId || node.key
  return privacyMode.value ? maskRelationshipGalaxyPrivateText(name) : name
}

function platformIdentity(node: PeopleRelationshipGraphNode): string {
  const identity = node.platformId || node.key
  return privacyMode.value ? maskRelationshipGalaxyPrivateText(identity) : identity
}

function poolLabel(node: Pick<PeopleRelationshipGraphNode, 'pool' | 'friendSource' | 'kind'>): string {
  if (node.kind === 'owner') return t('relationships.owner.type')
  if (node.friendSource === 'manual') return t('relationships.pool.manualFriend')
  return node.pool === 'friend' ? t('relationships.pool.friend') : t('relationships.pool.nonFriend')
}

function formatTaskProgress(nextTask: PeopleRelationshipsTaskState | null): string {
  return t('relationships.task.running', {
    current: formatNumber(nextTask?.processedSessions ?? 0),
    total: formatNumber(nextTask?.totalSessions ?? 0),
  })
}

function applyGraphResponse(next: PeopleRelationshipsGraphResponse) {
  const nextGraphContentKey = buildGraphContentKey(next, graphScope.value)
  if (graphContentKey && graphContentKey !== nextGraphContentKey) clearSavedPanoramaView()
  const previous = graphResponse.value
  graphResponse.value =
    previous && graphContentKey === nextGraphContentKey
      ? {
          ...next,
          graph: previous.graph,
        }
      : next
  graphContentKey = nextGraphContentKey
}

function applyNeighborhoodResponse(next: PeopleRelationshipsNeighborhoodResponse) {
  const nextGraphContentKey = buildGraphContentKey(next, `neighborhood:${next.contact?.key ?? ''}`)
  const previous = neighborhoodResponse.value
  neighborhoodResponse.value =
    previous && neighborhoodGraphContentKey === nextGraphContentKey
      ? {
          ...next,
          graph: previous.graph,
        }
      : next
  neighborhoodGraphContentKey = nextGraphContentKey
}

function clearNeighborhoodResponse() {
  neighborhoodResponse.value = null
  neighborhoodGraphContentKey = null
}

function buildGraphContentKey(response: RelationshipGraphResponseWithGraph, context: string): string {
  const graph = response.graph
  let hash = 2166136261
  hash = hashString(hash, context)
  hash = hashString(hash, response.algorithmVersion)
  hash = hashString(hash, response.cache.signature ?? '')
  hash = hashNumber(hash, response.timeRange.startTs ?? 0)
  hash = hashString(hash, response.timeRange.preset)

  for (const node of graph.nodes) {
    hash = hashString(hash, node.key)
    hash = hashString(hash, node.pool)
    hash = hashString(hash, node.friendSource ?? '')
    hash = hashNumber(hash, node.rank)
    hash = hashNumber(hash, Math.round(node.score * 1_000_000))
    hash = hashNumber(hash, node.labelVisibility)
    hash = hashNumber(hash, Math.round(node.x * 100))
    hash = hashNumber(hash, Math.round(node.y * 100))
    hash = hashNumber(hash, Math.round(node.size * 100))
  }

  for (const edge of graph.edges) {
    hash = hashString(hash, edge.id)
    hash = hashString(hash, edge.sourceKey)
    hash = hashString(hash, edge.targetKey)
    hash = hashNumber(hash, Math.round(edge.weight * 1_000_000))
    hash = hashNumber(hash, edge.visibility)
  }

  for (const community of graph.communities) {
    hash = hashString(hash, community.id)
    hash = hashNumber(hash, community.size)
    hash = hashString(hash, community.color)
  }

  return `${context}:${graph.nodes.length}:${graph.edges.length}:${graph.communities.length}:${hash >>> 0}`
}

function hashString(hash: number, value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash
}

function hashNumber(hash: number, value: number): number {
  return hashString(hash, String(value))
}

function stopPolling() {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
}

function cancelNeighborhoodLoad() {
  neighborhoodRequestId.value += 1
  isLoadingNeighborhood.value = false
  loadingNeighborhoodKey.value = null
}

function rememberPanoramaViewBeforeSelection() {
  if (selectedKey.value || savedPanoramaView.value) return
  savedPanoramaView.value = canvasRef.value?.captureView() ?? null
}

function clearSavedPanoramaView() {
  savedPanoramaView.value = null
}

function restorePanoramaView() {
  const view = savedPanoramaView.value
  clearSavedPanoramaView()

  void nextTick(() => {
    const restored = view ? canvasRef.value?.restoreView(view) === true : false
    if (!restored) canvasRef.value?.fitView()
    void nextTick(() => {
      isRestoringPanoramaView = false
    })
  })
}

function syncPolling(nextTask: PeopleRelationshipsTaskState | undefined) {
  if (nextTask?.status === 'running') {
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        void loadGraph({ silent: true, preserveNeighborhood: true })
      }, POLL_INTERVAL_MS)
    }
    return
  }

  stopPolling()
}

async function loadGraph(options: { silent?: boolean; preserveNeighborhood?: boolean } = {}) {
  const requestId = graphRequestId.value + 1
  graphRequestId.value = requestId
  const previousTaskStatus = task.value?.status ?? null
  const neighborhoodContactKey = options.preserveNeighborhood
    ? (neighborhoodResponse.value?.contact?.key ?? null)
    : null
  if (!options.silent) isLoading.value = true
  if (!options.preserveNeighborhood) {
    cancelNeighborhoodLoad()
    clearNeighborhoodResponse()
  }
  loadError.value = ''

  try {
    const next = await dataService.getPeopleRelationships({
      acceptStale: true,
      timeRangePreset: timeRangePreset.value,
      graphScope: graphScope.value,
      query: debouncedSearchQuery.value.trim() || undefined,
    })
    if (requestId !== graphRequestId.value) return

    applyGraphResponse(next)
    searchResultsQuery.value = debouncedSearchQuery.value.trim()
    if (selectedKey.value && !activeGraph.value.nodes.some((node) => node.key === selectedKey.value)) {
      selectedKey.value = null
      canvasSelectedKey.value = null
      isDetailPanelOpen.value = false
    }
    const pollingAction = resolveRelationshipGalaxyPollingAction({
      previousTaskStatus,
      nextTaskStatus: next.task?.status ?? null,
      neighborhoodContactKey,
    })
    syncPolling(next.task)
    if (pollingAction.type === 'refresh-neighborhood') void loadNeighborhood(pollingAction.key)
  } catch (error) {
    if (requestId !== graphRequestId.value) return
    loadError.value = String(error)
    toast.fail(t('relationships.toast.loadFailed'), { description: String(error) })
    stopPolling()
  } finally {
    if (requestId === graphRequestId.value) isLoading.value = false
  }
}

async function recomputeRelationships() {
  isRecomputing.value = true
  loadError.value = ''

  try {
    const next = await dataService.recomputePeopleRelationships({
      timeRangePreset: timeRangePreset.value,
      graphScope: graphScope.value,
      query: debouncedSearchQuery.value.trim() || undefined,
    })
    applyGraphResponse(next)
    searchResultsQuery.value = debouncedSearchQuery.value.trim()
    cancelNeighborhoodLoad()
    clearNeighborhoodResponse()
    selectedKey.value = null
    canvasSelectedKey.value = null
    isDetailPanelOpen.value = false
    syncPolling(next.task)
    toast.success(t('relationships.toast.recomputeStarted'))
  } catch (error) {
    toast.fail(t('relationships.toast.recomputeFailed'), { description: String(error) })
  } finally {
    isRecomputing.value = false
  }
}

const relationshipsHeader = computed(() => ({
  title: t('layout.relationships'),
  description: t('relationships.subtitle'),
  icon: 'i-lucide-git-fork',
  iconClass: 'bg-primary-600 text-white dark:bg-primary-500 dark:text-white shadow-sm',
  action: {
    label: t('relationships.actions.recompute'),
    icon: 'i-lucide-refresh-cw',
    loading: isRecomputing.value,
    disabled: isTaskRunning.value,
    class: 'border border-sky-100 hover:border-sky-200 dark:border-sky-950/30 dark:hover:border-sky-900/50',
    onClick: recomputeRelationships,
  },
  stats: [
    {
      id: 'nodes',
      label: t('relationships.stats.nodes'),
      value: formatNumber(stats.value.nodes),
    },
    {
      id: 'edges',
      label: t('relationships.stats.edges'),
      value: formatNumber(stats.value.edges),
    },
    {
      id: 'communities',
      label: t('relationships.stats.communities'),
      value: formatNumber(stats.value.communities),
      dividerBefore: true,
    },
  ],
}))

usePeoplePageHeader(relationshipsHeader)

async function loadNeighborhood(key: string) {
  const requestId = neighborhoodRequestId.value + 1
  neighborhoodRequestId.value = requestId
  isLoadingNeighborhood.value = true
  loadingNeighborhoodKey.value = key
  loadError.value = ''

  try {
    const next = await dataService.getPeopleRelationshipNeighborhood(key, {
      acceptStale: true,
      timeRangePreset: timeRangePreset.value,
    })
    if (requestId !== neighborhoodRequestId.value) return

    applyNeighborhoodResponse(next)
    selectedKey.value = next.contact?.key ?? key
    canvasSelectedKey.value = selectedKey.value
    syncPolling(next.task)
    await nextTick()
    canvasRef.value?.fitView()
  } catch (error) {
    if (requestId !== neighborhoodRequestId.value) return
    toast.fail(t('relationships.toast.neighborhoodFailed'), { description: String(error) })
  } finally {
    if (requestId === neighborhoodRequestId.value) {
      isLoadingNeighborhood.value = false
      loadingNeighborhoodKey.value = null
    }
  }
}

async function focusSelectedConnections() {
  if (!selectedKey.value) return
  await loadNeighborhood(selectedKey.value)
}

async function selectSearchResult(result: PeopleRelationshipsSearchResult) {
  rememberPanoramaViewBeforeSelection()
  isSearchResultsOpen.value = false
  if (!result.inCoreGraph) loadingNeighborhoodKey.value = result.key
  selectedKey.value = result.key
  isDetailPanelOpen.value = true
  canvasSelectedKey.value = resolveRelationshipGalaxyCanvasSelectedKey({
    selectedKey: selectedKey.value,
    loadingNeighborhoodKey: loadingNeighborhoodKey.value,
    currentCanvasSelectedKey: canvasSelectedKey.value,
  })
  if (!result.inCoreGraph) {
    await loadNeighborhood(result.key)
    return
  }

  cancelNeighborhoodLoad()
  clearNeighborhoodResponse()
  await nextTick()
  canvasRef.value?.focusNode(result.key)
}

async function selectNode(node: PeopleRelationshipGraphNode) {
  rememberPanoramaViewBeforeSelection()
  const needsNeighborhood = neighborhoodResponse.value?.contact?.key !== node.key
  if (needsNeighborhood) loadingNeighborhoodKey.value = node.key
  selectedKey.value = node.key
  isDetailPanelOpen.value = true
  canvasSelectedKey.value = resolveRelationshipGalaxyCanvasSelectedKey({
    selectedKey: selectedKey.value,
    loadingNeighborhoodKey: loadingNeighborhoodKey.value,
    currentCanvasSelectedKey: canvasSelectedKey.value,
  })
  await nextTick()
  canvasRef.value?.focusNode(node.key)
  if (needsNeighborhood) {
    await loadNeighborhood(node.key)
    return
  }

  canvasSelectedKey.value = selectedKey.value
}

function handleThreeCanvasFallback() {
  if (viewMode.value !== '3d') return
  viewMode.value = '2d'
  toast.warn(t('relationships.toast.threeUnavailable'))
}

function backToPanorama() {
  isRestoringPanoramaView = true
  cancelNeighborhoodLoad()
  clearNeighborhoodResponse()
  selectedKey.value = null
  canvasSelectedKey.value = null
  isDetailPanelOpen.value = false
  restorePanoramaView()
}

function closeDetailPanel() {
  backToPanorama()
}

function clearSearch() {
  searchQuery.value = ''
  searchResultsQuery.value = ''
  isSearchResultsOpen.value = false
}

function fitCanvas() {
  canvasRef.value?.fitView()
}

function syncDetailPanelLayout() {
  isDetailSidePanelLayout.value = detailPanelMediaQuery?.matches ?? false
}

watch(timeRangePreset, () => {
  clearSavedPanoramaView()
  selectedKey.value = null
  canvasSelectedKey.value = null
  isDetailPanelOpen.value = false
  cancelNeighborhoodLoad()
  clearNeighborhoodResponse()
  void loadGraph()
})

watch(graphScope, () => {
  clearSavedPanoramaView()
  selectedKey.value = null
  canvasSelectedKey.value = null
  isDetailPanelOpen.value = false
  cancelNeighborhoodLoad()
  clearNeighborhoodResponse()
  void loadGraph()
})

watch(searchQuery, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  isSearchResultsOpen.value = value.trim().length > 0
  searchTimer = setTimeout(() => {
    debouncedSearchQuery.value = value
    void loadGraph({ silent: true, preserveNeighborhood: true })
  }, 260)
})

watch(viewMode, async () => {
  await nextTick()
  if (selectedKey.value) {
    canvasRef.value?.focusNode(selectedKey.value)
    return
  }
  canvasRef.value?.fitView()
})

watch(detailPanelSafeInsetRight, async () => {
  await nextTick()
  if (isRestoringPanoramaView) return
  if (selectedKey.value) {
    canvasRef.value?.focusNode(selectedKey.value)
    return
  }
  canvasRef.value?.fitView()
})

onMounted(() => {
  if (typeof window !== 'undefined') {
    detailPanelMediaQuery = window.matchMedia('(min-width: 768px)')
    syncDetailPanelLayout()
    detailPanelMediaQuery.addEventListener('change', syncDetailPanelLayout)
  }
  void loadGraph()
})

onBeforeUnmount(() => {
  detailPanelMediaQuery?.removeEventListener('change', syncDetailPanelLayout)
  stopPolling()
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div class="flex min-h-0 flex-1 overflow-hidden bg-white text-gray-900 dark:bg-page-dark dark:text-gray-100">
    <main class="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[#05070d] dark:bg-page-dark">
      <RelationshipGalaxyThreeCanvas
        v-if="viewMode === '3d'"
        ref="canvasRef"
        :graph="activeGraph"
        :selected-key="canvasSelectedKey"
        :privacy-mode="privacyMode"
        :safe-inset-right="detailPanelSafeInsetRight"
        :label="t('relationships.canvas.label3d')"
        :owner-label="t('relationships.owner.me')"
        @fallback="handleThreeCanvasFallback"
        @select-node="selectNode"
      />
      <RelationshipGalaxyCanvas
        v-else
        ref="canvasRef"
        :graph="activeGraph"
        :selected-key="canvasSelectedKey"
        :privacy-mode="privacyMode"
        :safe-inset-right="detailPanelSafeInsetRight"
        :label="t('relationships.canvas.label')"
        :owner-label="t('relationships.owner.me')"
        @select-node="selectNode"
      />

      <div class="absolute left-4 top-4 z-20 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-2">
        <UTabs v-model="timeRangePreset" :items="timeRangeTabs" :content="false" size="xs" class="min-w-max gap-0" />
        <UTabs v-model="graphScope" :items="graphScopeTabs" :content="false" size="xs" class="min-w-max gap-0" />
        <div class="relative w-28 max-w-full sm:w-32 lg:w-36">
          <UInput
            v-model="searchQuery"
            icon="i-lucide-search"
            :placeholder="t('relationships.search')"
            size="sm"
            class="w-full"
            @focus="isSearchResultsOpen = hasSearchQuery"
            @keydown.esc="isSearchResultsOpen = false"
          >
            <template v-if="searchQuery" #trailing>
              <UButton
                icon="i-heroicons-x-mark"
                variant="link"
                color="neutral"
                size="xs"
                :aria-label="t('relationships.actions.clearSearch')"
                @click="clearSearch"
              />
            </template>
          </UInput>

          <div
            v-if="showSearchResults"
            class="absolute left-0 top-full z-30 mt-2 max-h-80 w-72 overflow-y-auto rounded-2xl border border-gray-200/80 bg-white/95 p-2 shadow-2xl shadow-black/25 backdrop-blur-xl scrollbar-thin dark:border-white/10 dark:bg-page-dark/95"
          >
            <div
              class="px-2 pb-1.5 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
            >
              {{ t('relationships.searchResults.title') }}
            </div>
            <div class="space-y-1">
              <button
                v-for="result in searchResults"
                :key="result.key"
                type="button"
                class="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-gray-100/70 dark:hover:bg-white/5"
                :class="selectedKey === result.key ? 'bg-sky-50 dark:bg-sky-500/10' : ''"
                :disabled="isLoadingNeighborhood"
                @click="selectSearchResult(result)"
              >
                <LazyAvatar
                  :src="avatarSrc(result)"
                  :alt="displayName(result)"
                  :text="avatarText(result)"
                  root-class="h-8 w-8 shrink-0 shadow-sm border border-gray-250/20 dark:border-white/10"
                  image-class="h-8 w-8 rounded-full object-cover"
                  fallback-class="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"
                />
                <span class="min-w-0 flex-1">
                  <span
                    class="block truncate text-sm font-semibold text-gray-900 transition-colors group-hover:text-sky-600 dark:text-white dark:group-hover:text-sky-400"
                  >
                    {{ displayName(result) }}
                  </span>
                  <span class="block truncate text-[11px] text-gray-500 dark:text-gray-400">
                    {{ poolLabel(result) }} · #{{ result.rank }}
                  </span>
                </span>
                <span
                  v-if="!result.inCoreGraph"
                  class="shrink-0 rounded-md bg-sky-100/60 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600 dark:bg-sky-500/15 dark:text-sky-400"
                >
                  {{ t('relationships.searchResults.offCore') }}
                </span>
              </button>
            </div>
          </div>
        </div>
        <UButton
          icon="i-lucide-scan-line"
          color="neutral"
          variant="soft"
          size="xs"
          :aria-label="t('relationships.actions.fitView')"
          @click="fitCanvas"
        />
        <UButton
          :icon="privacyMode ? 'i-lucide-eye-off' : 'i-lucide-eye'"
          color="neutral"
          variant="soft"
          size="xs"
          @click="privacyMode = !privacyMode"
        >
          {{ t('relationships.privacy') }}
        </UButton>
        <UButton
          v-if="isNeighborhoodMode"
          icon="i-lucide-undo-2"
          color="neutral"
          variant="soft"
          size="xs"
          @click="backToPanorama"
        >
          {{ t('relationships.actions.backToPanorama') }}
        </UButton>
      </div>

      <div
        v-if="showUpdatingBanner"
        class="absolute bottom-6 left-1/2 z-20 flex max-w-[min(560px,calc(100%-2rem))] -translate-x-1/2 items-center gap-2.5 rounded-2xl border border-sky-500/20 bg-[#090d16]/85 px-4 py-2.5 text-center text-xs font-semibold text-sky-200 shadow-2xl shadow-sky-950/30 backdrop-blur-md animate-fade-in"
      >
        <span class="i-lucide-refresh-cw h-3.5 w-3.5 animate-spin text-sky-400"></span>
        <span>{{ statusText }}</span>
      </div>

      <LoadingState
        v-if="showInitialLoading"
        variant="overlay"
        :text="statusText || t('relationships.task.updating')"
      />

      <div
        v-else-if="!hasGraph"
        class="absolute inset-0 flex items-center justify-center text-sm font-medium text-gray-400"
      >
        {{ emptyStateText }}
      </div>

      <aside
        v-if="showDetailPanel"
        class="absolute inset-x-3 bottom-3 z-20 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-white/5 bg-white/10 shadow-2xl shadow-black/20 backdrop-blur-md dark:border-white/5 dark:bg-page-dark/10 md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:max-h-none md:w-[360px]"
      >
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          class="absolute right-2.5 top-2.5 z-10 bg-white/35 backdrop-blur-sm hover:bg-white/55 dark:bg-white/5 dark:hover:bg-white/10"
          :aria-label="t('relationships.actions.closeDetail')"
          @click="closeDetailPanel"
        />

        <div v-if="selectedNode" class="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 pt-5">
          <div class="shrink-0 space-y-2.5">
            <div class="flex items-center gap-3 pr-8">
              <LazyAvatar
                :src="avatarSrc(selectedNode)"
                :alt="displayName(selectedNode)"
                :text="avatarText(selectedNode)"
                root-class="h-11 w-11 shrink-0 overflow-hidden rounded-lg shadow-sm border border-gray-250/20 dark:border-white/10"
                image-class="h-11 w-11 rounded-lg object-cover"
                fallback-class="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sm font-bold text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"
              />
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-1.5">
                  <p class="truncate text-base font-bold text-gray-900 dark:text-white">
                    {{ displayName(selectedNode) }}
                  </p>
                  <span
                    class="shrink-0 rounded-full bg-white/45 px-1.5 py-0.5 font-mono text-[10px] font-bold text-gray-600 dark:bg-white/8 dark:text-gray-300"
                    :class="selectedNode.rank <= 3 ? 'text-amber-600 dark:text-amber-300' : ''"
                  >
                    #{{ selectedNode.rank }}
                  </span>
                </div>
                <p class="truncate text-xs text-gray-500 dark:text-gray-400">
                  {{ selectedNode.platform }} · {{ platformIdentity(selectedNode) }}
                </p>
              </div>
            </div>

            <UButton
              v-if="showFocusConnectionsAction"
              icon="i-lucide-network"
              color="primary"
              variant="soft"
              size="sm"
              block
              class="rounded-xl font-semibold shadow-sm border border-sky-100 hover:border-sky-200 dark:border-sky-950/30 dark:hover:border-sky-900/50"
              :loading="isLoadingNeighborhood"
              @click="focusSelectedConnections"
            >
              {{ t('relationships.actions.focusConnections') }}
            </UButton>

            <div class="grid grid-cols-3 gap-1 text-xs">
              <div
                class="min-w-0 rounded-md border border-gray-100/60 bg-gray-50/35 p-1.5 dark:border-white/5 dark:bg-white/3"
              >
                <p
                  class="mb-0.5 truncate text-[9px] font-semibold uppercase leading-3 tracking-wide text-gray-400 dark:text-gray-500"
                >
                  {{ t('relationships.detail.score') }}
                </p>
                <div class="flex min-w-0 items-baseline gap-0.5">
                  <p class="font-mono text-sm font-bold leading-4 text-sky-600 dark:text-sky-400">
                    {{ formatScore(selectedNode.score) }}
                  </p>
                  <span class="text-[9px] leading-3 text-gray-400">/100</span>
                </div>
              </div>

              <div
                class="min-w-0 rounded-md border border-gray-100/60 bg-gray-50/35 p-1.5 dark:border-white/5 dark:bg-white/3"
              >
                <p
                  class="mb-0.5 truncate text-[9px] font-semibold uppercase leading-3 tracking-wide text-gray-400 dark:text-gray-500"
                >
                  {{ t('relationships.detail.type') }}
                </p>
                <span
                  class="inline-flex max-w-full items-center truncate text-[10px] font-semibold leading-4"
                  :class="
                    selectedNode.pool === 'friend'
                      ? 'text-sky-700 dark:text-sky-300'
                      : 'text-amber-700 dark:text-amber-300'
                  "
                >
                  {{ poolLabel(selectedNode) }}
                </span>
              </div>

              <div
                class="min-w-0 rounded-md border border-gray-100/60 bg-gray-50/35 p-1.5 dark:border-white/5 dark:bg-white/3"
              >
                <p
                  class="mb-0.5 truncate text-[9px] font-semibold uppercase leading-3 tracking-wide text-gray-400 dark:text-gray-500"
                >
                  {{ t('relationships.detail.privateMessages') }}
                </p>
                <span class="block truncate font-mono text-sm font-bold leading-4 text-gray-900 dark:text-white">
                  {{ formatNumber(selectedNode.privateMessageCount) }}
                </span>
              </div>

              <div
                class="min-w-0 rounded-md border border-gray-100/60 bg-gray-50/35 p-1.5 dark:border-white/5 dark:bg-white/3"
              >
                <p
                  class="mb-0.5 truncate text-[9px] font-semibold uppercase leading-3 tracking-wide text-gray-400 dark:text-gray-500"
                >
                  {{ t('relationships.detail.groupMessages') }}
                </p>
                <span class="block truncate font-mono text-sm font-bold leading-4 text-gray-900 dark:text-white">
                  {{ formatNumber(selectedNode.groupMessageCount) }}
                </span>
              </div>

              <div
                class="min-w-0 rounded-md border border-gray-100/60 bg-gray-50/35 p-1.5 dark:border-white/5 dark:bg-white/3"
              >
                <p
                  class="mb-0.5 truncate text-[9px] font-semibold uppercase leading-3 tracking-wide text-gray-400 dark:text-gray-500"
                >
                  {{ t('relationships.detail.commonGroups') }}
                </p>
                <span class="block truncate font-mono text-sm font-bold leading-4 text-gray-900 dark:text-white">
                  {{ formatNumber(selectedNode.commonGroupCount) }}
                </span>
              </div>

              <div
                class="min-w-0 rounded-md border border-gray-100/60 bg-gray-50/35 p-1.5 dark:border-white/5 dark:bg-white/3"
              >
                <p
                  class="mb-0.5 truncate text-[9px] font-semibold uppercase leading-3 tracking-wide text-gray-400 dark:text-gray-500"
                >
                  {{ t('relationships.detail.lastInteraction') }}
                </p>
                <span class="block truncate text-[11px] font-semibold leading-4 text-gray-900 dark:text-white">
                  {{ formatTime(selectedNode.lastInteractionTs) }}
                </span>
              </div>
            </div>
          </div>

          <div class="flex min-h-0 flex-1 flex-col gap-2">
            <section
              class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-100/80 bg-gray-50/25 p-2.5 shadow-sm dark:border-white/5 dark:bg-white/2"
            >
              <div class="mb-2 flex shrink-0 items-center justify-between gap-3 pl-1 pr-3">
                <div class="flex min-w-0 items-center gap-2">
                  <h3 class="truncate text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {{ t('relationships.connections.title') }}
                  </h3>
                  <span class="shrink-0 font-mono text-[10px] font-bold text-gray-400 dark:text-gray-500">
                    {{ formatConnectionRankingCount() }}
                  </span>
                </div>
                <span
                  class="w-14 shrink-0 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500"
                >
                  {{ t('relationships.connections.connectionScore') }}
                </span>
              </div>

              <div
                v-if="connectionRanking.items.length > 0"
                class="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 scrollbar-thin"
              >
                <button
                  v-for="item in connectionRanking.items"
                  :key="item.node.key"
                  type="button"
                  class="group flex h-9 w-full items-center gap-2 rounded-lg px-2 py-0 text-left transition-all duration-250 hover:bg-white dark:hover:bg-white/5"
                  @click="selectNode(item.node)"
                >
                  <LazyAvatar
                    :src="avatarSrc(item.node)"
                    :alt="displayName(item.node)"
                    :text="avatarText(item.node)"
                    root-class="h-6 w-6 shrink-0 overflow-hidden rounded-md shadow-sm border border-gray-250/20 dark:border-white/10"
                    image-class="h-6 w-6 rounded-md object-cover"
                    fallback-class="flex h-6 w-6 items-center justify-center rounded-md bg-sky-100 text-[9px] font-bold text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"
                  />

                  <div class="min-w-0 flex-1">
                    <span
                      class="block truncate text-[13px] font-semibold leading-4 text-gray-900 transition-colors group-hover:text-sky-600 dark:text-white dark:group-hover:text-sky-400"
                    >
                      {{ displayName(item.node) }}
                    </span>
                  </div>

                  <span class="flex w-14 shrink-0 justify-end">
                    <span class="font-mono text-[10px] font-bold text-gray-500 dark:text-gray-400">
                      {{ formatNumber(item.connectionScore) }}
                    </span>
                  </span>
                </button>
              </div>

              <p v-else class="py-4 text-center text-xs text-gray-400 dark:text-gray-500">
                {{ t('relationships.connections.empty') }}
              </p>
            </section>

            <section
              v-if="topCommunities.length > 0"
              class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-100/80 bg-gray-50/25 p-2.5 shadow-sm dark:border-white/5 dark:bg-white/2"
            >
              <div class="mb-2 flex shrink-0 items-center justify-between gap-3 pl-1 pr-3">
                <div class="flex min-w-0 items-center gap-2">
                  <h2 class="truncate text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {{ t('relationships.stats.communities') }}
                  </h2>
                  <span class="shrink-0 font-mono text-[10px] font-bold text-gray-400 dark:text-gray-500">
                    {{ formatNumber(topCommunities.length) }}
                  </span>
                </div>
                <span
                  class="w-14 shrink-0 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500"
                >
                  {{ t('relationships.stats.members') }}
                </span>
              </div>
              <div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 scrollbar-thin">
                <div
                  v-for="community in topCommunities"
                  :key="community.id"
                  class="flex h-9 items-center justify-between gap-2 rounded-lg px-2 py-0 text-[13px] leading-4"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/45 shadow-sm dark:bg-white/5"
                    >
                      <span class="h-2 w-2 rounded-full shadow-sm" :style="{ backgroundColor: community.color }" />
                    </span>
                    <span class="truncate font-semibold leading-4 text-gray-700 dark:text-gray-200">
                      {{ community.label }}
                    </span>
                  </div>
                  <span class="flex w-14 shrink-0 justify-end">
                    <span class="font-mono text-[10px] font-bold text-gray-500 dark:text-gray-400">
                      {{ formatNumber(community.size) }}
                    </span>
                  </span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </aside>
    </main>
  </div>
</template>
