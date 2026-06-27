<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CONTACTS_TIME_RANGE_PRESETS } from '@openchatlab/shared-types'
import type {
  ContactsTimeRangePreset,
  PeopleRelationshipGraphNode,
  PeopleRelationshipsGraphData,
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
import RelationshipGalaxyCanvas from './components/RelationshipGalaxyCanvas.vue'

type GalaxyCanvasInstance = InstanceType<typeof RelationshipGalaxyCanvas>

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
const searchQuery = ref('')
const debouncedSearchQuery = ref('')
const selectedKey = ref<string | null>(null)
const graphResponse = ref<PeopleRelationshipsGraphResponse | null>(null)
const neighborhoodResponse = ref<PeopleRelationshipsNeighborhoodResponse | null>(null)
const isLoading = ref(false)
const isRecomputing = ref(false)
const isLoadingNeighborhood = ref(false)
const privacyMode = ref(false)
const loadError = ref('')
const graphRequestId = ref(0)
const canvasRef = ref<GalaxyCanvasInstance | null>(null)

let pollTimer: ReturnType<typeof setInterval> | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null

const numberFormatter = computed(() => new Intl.NumberFormat(locale.value))

const timeRangeTabs = computed(() =>
  CONTACTS_TIME_RANGE_PRESETS.map((preset) => ({
    label: t(`relationships.timeRange.${preset}`),
    value: preset,
  }))
)

const activeGraph = computed(() => neighborhoodResponse.value?.graph ?? graphResponse.value?.graph ?? EMPTY_GRAPH)
const isNeighborhoodMode = computed(() => Boolean(neighborhoodResponse.value))
const hasGraph = computed(() => activeGraph.value.nodes.length > 0)
const diagnostics = computed(() => graphResponse.value?.diagnostics ?? neighborhoodResponse.value?.diagnostics ?? null)
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

const stats = computed(() => ({
  nodes: diagnostics.value?.totalNodes ?? activeGraph.value.nodes.length,
  edges: diagnostics.value?.totalEdges ?? activeGraph.value.edges.length,
  communities: activeGraph.value.communities.length,
}))

const topCommunities = computed(() => [...activeGraph.value.communities].sort((a, b) => b.size - a.size).slice(0, 8))

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
  return (node.displayName || node.platformId || '?').slice(0, 1)
}

function displayName(node: PeopleRelationshipGraphNode | PeopleRelationshipsSearchResult): string {
  if (privacyMode.value) return `#${node.rank}`
  return node.displayName || node.platformId || node.key
}

function poolLabel(node: Pick<PeopleRelationshipGraphNode, 'pool' | 'friendSource'>): string {
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
  loadError.value = ''

  try {
    const next = await dataService.getPeopleRelationships({
      acceptStale: true,
      timeRangePreset: timeRangePreset.value,
      query: debouncedSearchQuery.value.trim() || undefined,
    })
    if (requestId !== graphRequestId.value) return

    graphResponse.value = next
    if (!options.preserveNeighborhood) neighborhoodResponse.value = null
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
      query: debouncedSearchQuery.value.trim() || undefined,
    })
    graphResponse.value = next
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
  isLoadingNeighborhood.value = true
  loadError.value = ''

  try {
    const next = await dataService.getPeopleRelationshipNeighborhood(key, {
      acceptStale: true,
      timeRangePreset: timeRangePreset.value,
    })
    neighborhoodResponse.value = next
    selectedKey.value = next.contact?.key ?? key
    syncPolling(next.task)
    await nextTick()
    canvasRef.value?.focusNode(selectedKey.value)
  } catch (error) {
    toast.fail(t('relationships.toast.neighborhoodFailed'), { description: String(error) })
  } finally {
    isLoadingNeighborhood.value = false
  }
}

async function selectSearchResult(result: PeopleRelationshipsSearchResult) {
  selectedKey.value = result.key
  if (!result.inCoreGraph) {
    await loadNeighborhood(result.key)
    return
  }

  neighborhoodResponse.value = null
  await nextTick()
  canvasRef.value?.focusNode(result.key)
}

async function selectNode(node: PeopleRelationshipGraphNode) {
  selectedKey.value = node.key
  await nextTick()
  canvasRef.value?.focusNode(node.key)
}

function backToPanorama() {
  const key = selectedKey.value
  neighborhoodResponse.value = null
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
        <RelationshipGalaxyCanvas
          ref="canvasRef"
          :graph="activeGraph"
          :selected-key="selectedKey"
          :privacy-mode="privacyMode"
          :label="t('relationships.canvas.label')"
          @select-node="selectNode"
        />

        <div class="absolute left-4 top-4 z-20 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-2">
          <UTabs v-model="timeRangePreset" :items="timeRangeTabs" :content="false" size="xs" class="min-w-max gap-0" />
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
          class="absolute bottom-4 left-1/2 z-20 max-w-[min(560px,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-white/10 bg-gray-950/82 px-4 py-2 text-center text-sm font-medium text-gray-100 shadow-2xl backdrop-blur"
        >
          {{ statusText }}
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
        class="flex w-[340px] shrink-0 flex-col border-l border-gray-200 bg-white/96 dark:border-white/10 dark:bg-gray-950/96"
      >
        <div class="border-b border-gray-200 p-4 dark:border-white/10">
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

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <section v-if="searchResults.length > 0" class="mb-5">
            <h2 class="mb-2 text-xs font-semibold uppercase tracking-normal text-gray-500 dark:text-gray-400">
              {{ t('relationships.searchResults.title') }}
            </h2>
            <div class="space-y-1">
              <button
                v-for="result in searchResults"
                :key="result.key"
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-gray-100 dark:hover:bg-white/10"
                :class="selectedKey === result.key ? 'bg-sky-50 dark:bg-sky-500/10' : ''"
                :disabled="isLoadingNeighborhood"
                @click="selectSearchResult(result)"
              >
                <LazyAvatar
                  :src="result.avatar"
                  :alt="displayName(result)"
                  :text="avatarText(result)"
                  root-class="h-8 w-8 shrink-0"
                  image-class="h-8 w-8 rounded-full object-cover"
                  fallback-class="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold text-gray-900 dark:text-white">
                    {{ displayName(result) }}
                  </span>
                  <span class="block truncate text-xs text-gray-500 dark:text-gray-400">
                    {{ poolLabel(result) }} · #{{ result.rank }}
                  </span>
                </span>
                <span v-if="!result.inCoreGraph" class="text-[11px] font-medium text-sky-600 dark:text-sky-300">
                  {{ t('relationships.searchResults.offCore') }}
                </span>
              </button>
            </div>
          </section>

          <section class="mb-5">
            <h2 class="mb-3 text-xs font-semibold uppercase tracking-normal text-gray-500 dark:text-gray-400">
              {{ t('relationships.detail.title') }}
            </h2>

            <div v-if="selectedNode" class="space-y-4">
              <div class="flex items-center gap-3">
                <LazyAvatar
                  :src="selectedNode.avatar"
                  :alt="displayName(selectedNode)"
                  :text="avatarText(selectedNode)"
                  root-class="h-11 w-11 shrink-0"
                  image-class="h-11 w-11 rounded-full object-cover"
                  fallback-class="flex h-11 w-11 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"
                />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-base font-semibold text-gray-900 dark:text-white">
                    {{ displayName(selectedNode) }}
                  </p>
                  <p class="truncate text-xs text-gray-500 dark:text-gray-400">
                    {{ selectedNode.platform }} · {{ selectedNode.platformId }}
                  </p>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-2 text-sm">
                <div class="rounded-lg bg-gray-50 px-3 py-2 dark:bg-white/5">
                  <p class="text-[11px] text-gray-500 dark:text-gray-400">{{ t('relationships.detail.rank') }}</p>
                  <p class="font-mono font-semibold text-gray-900 dark:text-white">#{{ selectedNode.rank }}</p>
                </div>
                <div class="rounded-lg bg-gray-50 px-3 py-2 dark:bg-white/5">
                  <p class="text-[11px] text-gray-500 dark:text-gray-400">{{ t('relationships.detail.score') }}</p>
                  <p class="font-mono font-semibold text-gray-900 dark:text-white">
                    {{ formatScore(selectedNode.score) }}
                  </p>
                </div>
                <div class="rounded-lg bg-gray-50 px-3 py-2 dark:bg-white/5">
                  <p class="text-[11px] text-gray-500 dark:text-gray-400">{{ t('relationships.detail.type') }}</p>
                  <p class="truncate font-semibold text-gray-900 dark:text-white">{{ poolLabel(selectedNode) }}</p>
                </div>
                <div class="rounded-lg bg-gray-50 px-3 py-2 dark:bg-white/5">
                  <p class="text-[11px] text-gray-500 dark:text-gray-400">{{ t('relationships.detail.community') }}</p>
                  <p class="truncate font-semibold text-gray-900 dark:text-white">{{ selectedNode.communityId }}</p>
                </div>
              </div>

              <dl class="space-y-2 text-sm">
                <div class="flex items-center justify-between gap-3">
                  <dt class="text-gray-500 dark:text-gray-400">{{ t('relationships.detail.privateMessages') }}</dt>
                  <dd class="font-mono font-semibold text-gray-900 dark:text-white">
                    {{ formatNumber(selectedNode.privateMessageCount) }}
                  </dd>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <dt class="text-gray-500 dark:text-gray-400">{{ t('relationships.detail.groupMessages') }}</dt>
                  <dd class="font-mono font-semibold text-gray-900 dark:text-white">
                    {{ formatNumber(selectedNode.groupMessageCount) }}
                  </dd>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <dt class="text-gray-500 dark:text-gray-400">{{ t('relationships.detail.commonGroups') }}</dt>
                  <dd class="font-mono font-semibold text-gray-900 dark:text-white">
                    {{ formatNumber(selectedNode.commonGroupCount) }}
                  </dd>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <dt class="text-gray-500 dark:text-gray-400">{{ t('relationships.detail.lastInteraction') }}</dt>
                  <dd class="font-medium text-gray-900 dark:text-white">
                    {{ formatTime(selectedNode.lastInteractionTs) }}
                  </dd>
                </div>
              </dl>
            </div>

            <div
              v-else
              class="rounded-lg border border-dashed border-gray-200 px-3 py-8 text-center dark:border-white/10"
            >
              <p class="text-sm font-medium text-gray-500 dark:text-gray-400">
                {{ t('relationships.detail.emptyTitle') }}
              </p>
            </div>
          </section>

          <section v-if="topCommunities.length > 0">
            <h2 class="mb-2 text-xs font-semibold uppercase tracking-normal text-gray-500 dark:text-gray-400">
              {{ t('relationships.stats.communities') }}
            </h2>
            <div class="space-y-2">
              <div
                v-for="community in topCommunities"
                :key="community.id"
                class="flex items-center justify-between gap-3 text-sm"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: community.color }"></span>
                  <span class="truncate font-medium text-gray-700 dark:text-gray-200">{{ community.label }}</span>
                </div>
                <span class="font-mono text-xs text-gray-500 dark:text-gray-400">
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
