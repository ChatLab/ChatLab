<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import PageHeader from '@/components/layout/PageHeader.vue'
import { LoadingState } from '@/components/UI'
import LazyAvatar from '@/components/common/avatar/LazyAvatar.vue'
import PeopleSubnav from '../components/PeopleSubnav.vue'
import { buildRelationshipConnectionRanking } from './relationship-galaxy-connections'
import { shouldShowFocusConnectionsAction } from './relationship-galaxy-state'
import RelationshipGalaxyCanvas from './components/RelationshipGalaxyCanvas.vue'
import RelationshipGalaxyThreeCanvas from './components/RelationshipGalaxyThreeCanvas.vue'

type GalaxyCanvasInstance = {
  focusNode: (key: string) => boolean
  fitView: () => void
}
type GalaxyViewMode = '3d' | '2d'

const EMPTY_GRAPH: PeopleRelationshipsGraphData = {
  nodes: [],
  edges: [],
  communities: [],
}

const POLL_INTERVAL_MS = 1400

const { t, locale } = useI18n()
const dataService = useDataService()
const toast = useToast()

const timeRangePreset = ref<ContactsTimeRangePreset>('1y')
const graphScope = ref<PeopleRelationshipsGraphScope>('panorama')
const searchQuery = ref('')
const debouncedSearchQuery = ref('')
const selectedKey = ref<string | null>(null)
const graphResponse = ref<PeopleRelationshipsGraphResponse | null>(null)
const neighborhoodResponse = ref<PeopleRelationshipsNeighborhoodResponse | null>(null)
const isLoading = ref(false)
const isRecomputing = ref(false)
const isLoadingNeighborhood = ref(false)
const privacyMode = ref(false)
const viewMode = ref<GalaxyViewMode>('3d')
const loadError = ref('')
const graphRequestId = ref(0)
const neighborhoodRequestId = ref(0)
const canvasRef = ref<GalaxyCanvasInstance | null>(null)
const isConnectionRankingExpanded = ref(false)

let pollTimer: ReturnType<typeof setInterval> | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null

const numberFormatter = computed(() => new Intl.NumberFormat(locale.value))

const timeRangeTabs = computed(() =>
  CONTACTS_TIME_RANGE_PRESETS.map((preset) => ({
    label: t(`relationships.timeRange.${preset}`),
    value: preset,
  }))
)
const viewModeTabs = computed(() => [
  {
    label: t('relationships.viewMode.3d'),
    value: '3d' as const,
  },
  {
    label: t('relationships.viewMode.2d'),
    value: '2d' as const,
  },
])
const graphScopeTabs = computed(() => [
  {
    label: t('relationships.graphScope.panorama'),
    value: 'panorama' as const,
  },
  {
    label: t('relationships.graphScope.close'),
    value: 'close' as const,
  },
])

const activeGraph = computed(() => neighborhoodResponse.value?.graph ?? graphResponse.value?.graph ?? EMPTY_GRAPH)
const isNeighborhoodMode = computed(() => Boolean(neighborhoodResponse.value))
const hasGraph = computed(() => activeGraph.value.nodes.length > 0)
const task = computed(() => graphResponse.value?.task ?? neighborhoodResponse.value?.task ?? null)
const isTaskRunning = computed(() => task.value?.status === 'running')
const isTaskFailed = computed(() => task.value?.status === 'failed')
const cacheStatus = computed(() => graphResponse.value?.cache.status ?? neighborhoodResponse.value?.cache.status)
const searchResults = computed(() => graphResponse.value?.searchResults ?? [])
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
const showFocusConnectionsAction = computed(() =>
  shouldShowFocusConnectionsAction({
    selectedKey: selectedKey.value,
    isNeighborhoodMode: isNeighborhoodMode.value,
    neighborhoodContactKey: neighborhoodResponse.value?.contact?.key ?? null,
  })
)
const connectionRanking = computed(() =>
  buildRelationshipConnectionRanking(activeGraph.value, selectedKey.value, {
    expanded: isConnectionRankingExpanded.value,
  })
)

const stats = computed(() => ({
  nodes: activeGraph.value.nodes.length,
  edges: activeGraph.value.edges.length,
  communities: activeGraph.value.communities.length,
}))

const topCommunities = computed(() => [...activeGraph.value.communities].sort((a, b) => b.size - a.size).slice(0, 8))

function getCommunityColor(communityId: string): string {
  const community = activeGraph.value.communities.find((c) => c.id === communityId)
  return community?.color ?? '#94a3b8'
}

const statusText = computed(() => {
  if (cacheStatus.value === 'stale' && isTaskRunning.value) return t('relationships.task.updating')
  if (isTaskRunning.value) return formatTaskProgress(task.value)
  if (isTaskFailed.value) return task.value?.lastError || t('relationships.task.failed')
  return ''
})

function formatNumber(value: number): string {
  return numberFormatter.value.format(value)
}

function formatScore(score: number): string {
  return Math.round(score * 100).toString()
}

function formatTime(ts: number | null | undefined): string {
  if (!ts) return t('relationships.detail.emptyValue')
  return new Date(ts * 1000).toLocaleDateString()
}

function avatarText(node: PeopleRelationshipGraphNode | PeopleRelationshipsSearchResult): string {
  if (node.kind === 'owner') return t('relationships.owner.avatarText')
  return (node.displayName || node.platformId || '?').slice(0, 1)
}

function displayName(node: PeopleRelationshipGraphNode | PeopleRelationshipsSearchResult): string {
  if (node.kind === 'owner') return t('relationships.owner.me')
  if (privacyMode.value) return `#${node.rank}`
  return node.displayName || node.platformId || node.key
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

function stopPolling() {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
}

function cancelNeighborhoodLoad() {
  neighborhoodRequestId.value += 1
  isLoadingNeighborhood.value = false
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
  if (!options.silent) isLoading.value = true
  if (!options.preserveNeighborhood) {
    cancelNeighborhoodLoad()
    neighborhoodResponse.value = null
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

    graphResponse.value = next
    if (selectedKey.value && !activeGraph.value.nodes.some((node) => node.key === selectedKey.value)) {
      selectedKey.value = null
    }
    syncPolling(next.task)
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
    graphResponse.value = next
    cancelNeighborhoodLoad()
    neighborhoodResponse.value = null
    selectedKey.value = null
    syncPolling(next.task)
    toast.success(t('relationships.toast.recomputeStarted'))
  } catch (error) {
    toast.fail(t('relationships.toast.recomputeFailed'), { description: String(error) })
  } finally {
    isRecomputing.value = false
  }
}

async function loadNeighborhood(key: string) {
  const requestId = neighborhoodRequestId.value + 1
  neighborhoodRequestId.value = requestId
  isLoadingNeighborhood.value = true
  loadError.value = ''

  try {
    const next = await dataService.getPeopleRelationshipNeighborhood(key, {
      acceptStale: true,
      timeRangePreset: timeRangePreset.value,
    })
    if (requestId !== neighborhoodRequestId.value) return

    neighborhoodResponse.value = next
    selectedKey.value = next.contact?.key ?? key
    syncPolling(next.task)
    await nextTick()
    canvasRef.value?.focusNode(selectedKey.value)
  } catch (error) {
    if (requestId !== neighborhoodRequestId.value) return
    toast.fail(t('relationships.toast.neighborhoodFailed'), { description: String(error) })
  } finally {
    if (requestId === neighborhoodRequestId.value) isLoadingNeighborhood.value = false
  }
}

async function focusSelectedConnections() {
  if (!selectedKey.value) return
  await loadNeighborhood(selectedKey.value)
}

async function selectSearchResult(result: PeopleRelationshipsSearchResult) {
  selectedKey.value = result.key
  isConnectionRankingExpanded.value = false
  if (!result.inCoreGraph) {
    await loadNeighborhood(result.key)
    return
  }

  cancelNeighborhoodLoad()
  neighborhoodResponse.value = null
  await nextTick()
  canvasRef.value?.focusNode(result.key)
}

async function selectNode(node: PeopleRelationshipGraphNode) {
  selectedKey.value = node.key
  isConnectionRankingExpanded.value = false
  if (neighborhoodResponse.value?.contact?.key !== node.key) {
    await loadNeighborhood(node.key)
    return
  }

  await nextTick()
  canvasRef.value?.focusNode(node.key)
}

function handleThreeCanvasFallback() {
  if (viewMode.value !== '3d') return
  viewMode.value = '2d'
  toast.warn(t('relationships.toast.threeUnavailable'))
}

function backToPanorama() {
  const key = selectedKey.value
  cancelNeighborhoodLoad()
  neighborhoodResponse.value = null
  isConnectionRankingExpanded.value = false
  if (!key) return
  if (!graphResponse.value?.graph.nodes.some((node) => node.key === key)) selectedKey.value = null
  void nextTick(() => {
    if (selectedKey.value) canvasRef.value?.focusNode(selectedKey.value)
  })
}

function clearSearch() {
  searchQuery.value = ''
}

function fitCanvas() {
  canvasRef.value?.fitView()
}

watch(timeRangePreset, () => {
  selectedKey.value = null
  isConnectionRankingExpanded.value = false
  cancelNeighborhoodLoad()
  neighborhoodResponse.value = null
  void loadGraph()
})

watch(graphScope, () => {
  selectedKey.value = null
  isConnectionRankingExpanded.value = false
  cancelNeighborhoodLoad()
  neighborhoodResponse.value = null
  void loadGraph()
})

watch(searchQuery, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
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

onMounted(() => {
  void loadGraph()
})

onBeforeUnmount(() => {
  stopPolling()
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div
    class="flex h-full flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100"
    style="padding-top: var(--titlebar-area-height)"
  >
    <PageHeader
      :title="t('layout.relationships')"
      :description="t('relationships.subtitle')"
      size="compact"
      icon="i-lucide-git-fork"
      icon-class="bg-sky-600 text-white dark:bg-sky-500 dark:text-white shadow-sm"
    >
      <template #actions>
        <UButton
          icon="i-lucide-refresh-cw"
          color="primary"
          variant="soft"
          size="sm"
          class="rounded-xl border border-sky-100 hover:border-sky-200 dark:border-sky-950/30 dark:hover:border-sky-900/50"
          :loading="isRecomputing"
          :disabled="isTaskRunning"
          @click="recomputeRelationships"
        >
          {{ t('relationships.actions.recompute') }}
        </UButton>
      </template>

      <div class="mt-3 flex items-center justify-between gap-3 pb-1.5">
        <PeopleSubnav active="relationships" />

        <div class="hidden items-center gap-5 text-[11px] sm:flex">
          <div class="flex items-center gap-1.5">
            <span class="text-gray-400 dark:text-gray-500">{{ t('relationships.stats.nodes') }}</span>
            <span class="font-mono font-bold text-gray-900 dark:text-white">{{ formatNumber(stats.nodes) }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="text-gray-400 dark:text-gray-500">{{ t('relationships.stats.edges') }}</span>
            <span class="font-mono font-bold text-gray-900 dark:text-white">{{ formatNumber(stats.edges) }}</span>
          </div>
          <div class="h-3 w-px bg-gray-250 dark:bg-white/10"></div>
          <div class="flex items-center gap-1.5">
            <span class="text-gray-400 dark:text-gray-500">{{ t('relationships.stats.communities') }}</span>
            <span class="font-mono font-bold text-gray-900 dark:text-white">{{ formatNumber(stats.communities) }}</span>
          </div>
        </div>
      </div>
    </PageHeader>

    <div class="flex min-h-0 flex-1 overflow-hidden">
      <main class="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[#05070d]">
        <RelationshipGalaxyThreeCanvas
          v-if="viewMode === '3d'"
          ref="canvasRef"
          :graph="activeGraph"
          :selected-key="selectedKey"
          :privacy-mode="privacyMode"
          :label="t('relationships.canvas.label3d')"
          :owner-label="t('relationships.owner.me')"
          @fallback="handleThreeCanvasFallback"
          @select-node="selectNode"
        />
        <RelationshipGalaxyCanvas
          v-else
          ref="canvasRef"
          :graph="activeGraph"
          :selected-key="selectedKey"
          :privacy-mode="privacyMode"
          :label="t('relationships.canvas.label')"
          :owner-label="t('relationships.owner.me')"
          @select-node="selectNode"
        />

        <div class="absolute left-4 top-4 z-20 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-2">
          <UTabs v-model="timeRangePreset" :items="timeRangeTabs" :content="false" size="xs" class="min-w-max gap-0" />
          <UTabs v-model="graphScope" :items="graphScopeTabs" :content="false" size="xs" class="min-w-max gap-0" />
          <UTabs v-model="viewMode" :items="viewModeTabs" :content="false" size="xs" class="min-w-max gap-0" />
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
          {{ loadError || t('relationships.empty') }}
        </div>
      </main>

      <aside
        class="flex w-[340px] shrink-0 flex-col border-l border-gray-250/70 bg-white/80 backdrop-blur-md dark:border-white/10 dark:bg-gray-950/80"
      >
        <div class="border-b border-gray-200/80 p-4 dark:border-white/10">
          <UInput
            v-model="searchQuery"
            icon="i-lucide-search"
            :placeholder="t('relationships.search')"
            size="sm"
            class="w-full"
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
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-thin">
          <section v-if="searchResults.length > 0" class="mb-6">
            <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {{ t('relationships.searchResults.title') }}
            </h2>
            <div class="space-y-1">
              <button
                v-for="result in searchResults"
                :key="result.key"
                type="button"
                class="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-gray-100/50 dark:hover:bg-white/5"
                :class="selectedKey === result.key ? 'bg-sky-50 dark:bg-sky-500/10' : ''"
                :disabled="isLoadingNeighborhood"
                @click="selectSearchResult(result)"
              >
                <LazyAvatar
                  :src="result.avatar"
                  :alt="displayName(result)"
                  :text="avatarText(result)"
                  root-class="h-8 w-8 shrink-0 shadow-sm border border-gray-250/20 dark:border-white/10"
                  image-class="h-8 w-8 rounded-full object-cover"
                  fallback-class="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"
                />
                <span class="min-w-0 flex-1">
                  <span
                    class="block truncate text-sm font-semibold text-gray-900 dark:text-white group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors"
                  >
                    {{ displayName(result) }}
                  </span>
                  <span class="block truncate text-[11px] text-gray-500 dark:text-gray-400">
                    {{ poolLabel(result) }} · #{{ result.rank }}
                  </span>
                </span>
                <span
                  v-if="!result.inCoreGraph"
                  class="text-[10px] font-semibold text-sky-600 dark:text-sky-400 bg-sky-100/60 dark:bg-sky-500/15 px-1.5 py-0.5 rounded-md shrink-0"
                >
                  {{ t('relationships.searchResults.offCore') }}
                </span>
              </button>
            </div>
          </section>

          <section class="mb-6">
            <h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {{ t('relationships.detail.title') }}
            </h2>

            <div v-if="selectedNode" class="space-y-4">
              <div class="flex items-center gap-3">
                <LazyAvatar
                  :src="selectedNode.avatar"
                  :alt="displayName(selectedNode)"
                  :text="avatarText(selectedNode)"
                  root-class="h-11 w-11 shrink-0 shadow-sm border border-gray-250/20 dark:border-white/10"
                  image-class="h-11 w-11 rounded-full object-cover"
                  fallback-class="flex h-11 w-11 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"
                />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-base font-bold text-gray-900 dark:text-white">
                    {{ displayName(selectedNode) }}
                  </p>
                  <p class="truncate text-xs text-gray-500 dark:text-gray-400">
                    {{ selectedNode.platform }} · {{ selectedNode.platformId }}
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

              <div class="grid grid-cols-2 gap-2 text-sm">
                <div
                  class="rounded-xl border border-gray-100/80 bg-gray-50/50 p-3 dark:border-white/5 dark:bg-white/3 flex flex-col justify-between"
                >
                  <p class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">
                    {{ t('relationships.detail.rank') }}
                  </p>
                  <div class="flex items-center gap-1.5">
                    <p class="font-mono font-bold text-lg text-gray-900 dark:text-white">#{{ selectedNode.rank }}</p>
                    <span
                      v-if="selectedNode.rank <= 3"
                      class="flex h-2 w-2 rounded-full bg-amber-500 animate-pulse shrink-0"
                    ></span>
                  </div>
                </div>

                <div
                  class="rounded-xl border border-gray-100/80 bg-gray-50/50 p-3 dark:border-white/5 dark:bg-white/3 flex flex-col justify-between"
                >
                  <p class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">
                    {{ t('relationships.detail.score') }}
                  </p>
                  <div class="flex items-baseline gap-1">
                    <p class="font-mono font-bold text-lg text-sky-600 dark:text-sky-400">
                      {{ formatScore(selectedNode.score) }}
                    </p>
                    <span class="text-[9px] text-gray-400">/100</span>
                  </div>
                  <div class="mt-1.5 h-1 w-full rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
                    <div
                      class="h-full rounded-full bg-gradient-to-r from-sky-400 to-sky-600 dark:from-sky-500 dark:to-sky-300"
                      :style="{ width: `${formatScore(selectedNode.score)}%` }"
                    ></div>
                  </div>
                </div>

                <div class="rounded-xl border border-gray-100/80 bg-gray-50/50 p-3 dark:border-white/5 dark:bg-white/3">
                  <p class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">
                    {{ t('relationships.detail.type') }}
                  </p>
                  <span
                    class="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold"
                    :class="
                      selectedNode.pool === 'friend'
                        ? 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300'
                        : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                    "
                  >
                    {{ poolLabel(selectedNode) }}
                  </span>
                </div>

                <div
                  class="rounded-xl border border-gray-100/80 bg-gray-50/50 p-3 dark:border-white/5 dark:bg-white/3 flex flex-col justify-between"
                >
                  <p class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">
                    {{ t('relationships.detail.community') }}
                  </p>
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span
                      class="h-2.5 w-2.5 rounded-full shrink-0 shadow-sm"
                      :style="{ backgroundColor: getCommunityColor(selectedNode.communityId) }"
                    ></span>
                    <span class="font-mono text-sm font-semibold text-gray-900 dark:text-white truncate">
                      {{ selectedNode.communityId }}
                    </span>
                  </div>
                </div>
              </div>

              <div
                class="space-y-2.5 rounded-xl border border-gray-100/80 bg-gray-50/30 p-3.5 dark:border-white/5 dark:bg-white/2"
              >
                <div
                  class="flex items-center justify-between text-xs py-0.5 border-b border-gray-150/40 dark:border-white/5 pb-2"
                >
                  <span class="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    <span class="i-lucide-message-square h-3.5 w-3.5 text-gray-400"></span>
                    {{ t('relationships.detail.privateMessages') }}
                  </span>
                  <span class="font-mono font-bold text-gray-900 dark:text-white">
                    {{ formatNumber(selectedNode.privateMessageCount) }}
                  </span>
                </div>
                <div
                  class="flex items-center justify-between text-xs py-0.5 border-b border-gray-150/40 dark:border-white/5 pb-2"
                >
                  <span class="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    <span class="i-lucide-messages-square h-3.5 w-3.5 text-gray-400"></span>
                    {{ t('relationships.detail.groupMessages') }}
                  </span>
                  <span class="font-mono font-bold text-gray-900 dark:text-white">
                    {{ formatNumber(selectedNode.groupMessageCount) }}
                  </span>
                </div>
                <div
                  class="flex items-center justify-between text-xs py-0.5 border-b border-gray-150/40 dark:border-white/5 pb-2"
                >
                  <span class="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    <span class="i-lucide-users-round h-3.5 w-3.5 text-gray-400"></span>
                    {{ t('relationships.detail.commonGroups') }}
                  </span>
                  <span class="font-mono font-bold text-gray-900 dark:text-white">
                    {{ formatNumber(selectedNode.commonGroupCount) }}
                  </span>
                </div>
                <div class="flex items-center justify-between text-xs py-0.5 pb-0">
                  <span class="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    <span class="i-lucide-clock h-3.5 w-3.5 text-gray-400"></span>
                    {{ t('relationships.detail.lastInteraction') }}
                  </span>
                  <span class="font-semibold text-gray-900 dark:text-white">
                    {{ formatTime(selectedNode.lastInteractionTs) }}
                  </span>
                </div>
              </div>

              <section
                class="rounded-xl border border-gray-200/80 bg-gray-50/50 p-3 dark:border-white/5 dark:bg-white/3 shadow-sm"
              >
                <div class="mb-3 flex items-center justify-between gap-3 px-1">
                  <h3 class="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {{ t('relationships.connections.title') }}
                  </h3>
                  <span
                    class="font-mono text-xs font-bold text-gray-400 dark:text-gray-500 bg-gray-200/60 dark:bg-white/5 px-1.5 py-0.5 rounded"
                  >
                    {{ formatNumber(connectionRanking.total) }}
                  </span>
                </div>

                <div v-if="connectionRanking.items.length > 0" class="space-y-1">
                  <button
                    v-for="(item, index) in connectionRanking.items"
                    :key="item.node.key"
                    type="button"
                    class="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all duration-250 hover:bg-white dark:hover:bg-white/5"
                    @click="selectNode(item.node)"
                  >
                    <!-- Top 1-3 序号圆圈高亮，其他序号保持低调 -->
                    <span
                      class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold"
                      :class="
                        index === 0
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                          : index === 1
                            ? 'bg-slate-200 text-slate-700 dark:bg-slate-300/20 dark:text-slate-300'
                            : index === 2
                              ? 'bg-amber-700/10 text-amber-800 dark:bg-amber-700/20 dark:text-amber-400'
                              : 'text-gray-400 dark:text-gray-500'
                      "
                    >
                      {{ index + 1 }}
                    </span>

                    <LazyAvatar
                      :src="item.node.avatar"
                      :alt="displayName(item.node)"
                      :text="avatarText(item.node)"
                      root-class="h-7 w-7 shrink-0 shadow-sm border border-gray-250/20 dark:border-white/10"
                      image-class="h-7 w-7 rounded-full object-cover"
                      fallback-class="flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"
                    />

                    <div class="min-w-0 flex-1 space-y-0.5">
                      <span
                        class="block truncate text-sm font-semibold text-gray-900 dark:text-white group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors"
                      >
                        {{ displayName(item.node) }}
                      </span>
                      <!-- 迷你引力强度进度条 -->
                      <div class="flex items-center gap-1.5">
                        <div class="h-0.5 w-10 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden shrink-0">
                          <div
                            class="h-full rounded-full bg-sky-500/80 dark:bg-sky-400/80"
                            :style="{ width: `${formatScore(item.edge.weight)}%` }"
                          ></div>
                        </div>
                        <span class="text-[9px] font-medium text-gray-400 dark:text-gray-500 shrink-0">
                          {{ t('relationships.connections.weight', { value: formatScore(item.edge.weight) }) }}
                        </span>
                      </div>
                    </div>

                    <div class="flex shrink-0 items-center gap-1">
                      <span class="text-[11px] font-semibold text-gray-800 dark:text-gray-300">
                        {{
                          t('relationships.connections.replies', {
                            count: formatNumber(item.edge.replyInteractionCount),
                          })
                        }}
                      </span>
                      <span
                        class="i-lucide-chevron-right h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-all duration-200 text-gray-400 -translate-x-1 group-hover:translate-x-0"
                      ></span>
                    </div>
                  </button>

                  <UButton
                    v-if="connectionRanking.hasMore || isConnectionRankingExpanded"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    block
                    class="mt-2 rounded-lg font-medium hover:bg-gray-150/40 dark:hover:bg-white/5"
                    @click="isConnectionRankingExpanded = !isConnectionRankingExpanded"
                  >
                    {{
                      isConnectionRankingExpanded
                        ? t('relationships.connections.showLess')
                        : t('relationships.connections.showMore', {
                            count: formatNumber(connectionRanking.total - connectionRanking.items.length),
                          })
                    }}
                  </UButton>
                </div>

                <p v-else class="py-4 text-center text-xs text-gray-400 dark:text-gray-500">
                  {{ t('relationships.connections.empty') }}
                </p>
              </section>
            </div>

            <div
              v-else
              class="rounded-xl border border-dashed border-gray-200 px-3 py-10 text-center dark:border-white/10 bg-gray-50/20 dark:bg-white/2"
            >
              <p class="text-sm font-semibold text-gray-400 dark:text-gray-500">
                {{ t('relationships.detail.emptyTitle') }}
              </p>
            </div>
          </section>

          <section v-if="topCommunities.length > 0">
            <h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {{ t('relationships.stats.communities') }}
            </h2>
            <div
              class="space-y-2 rounded-xl border border-gray-100/80 bg-gray-50/20 p-3 dark:border-white/5 dark:bg-white/2"
            >
              <div
                v-for="community in topCommunities"
                :key="community.id"
                class="flex items-center justify-between gap-3 text-sm py-1 border-b border-gray-150/20 dark:border-white/5 last:border-b-0 last:pb-0"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <span
                    class="h-2.5 w-2.5 shrink-0 rounded-full shadow-sm"
                    :style="{ backgroundColor: community.color }"
                  ></span>
                  <span class="truncate font-semibold text-gray-700 dark:text-gray-200">{{ community.label }}</span>
                </div>
                <span
                  class="font-mono text-[10px] font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded shadow-sm shrink-0"
                >
                  {{ formatNumber(community.size) }}
                </span>
              </div>
            </div>
          </section>
        </div>
      </aside>
    </div>
  </div>
</template>
