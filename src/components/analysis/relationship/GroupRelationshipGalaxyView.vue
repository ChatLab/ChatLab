<script setup lang="ts">
// 群聊洞察中的独立关系视图。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  GroupRelationshipGalaxyData,
  GroupRelationshipGalaxyMemberDetail,
  RelationshipGalaxyRenderNode,
  TimeFilter,
} from '@openchatlab/shared-types'
import { LoadingState } from '@/components/UI'
import LazyAvatar from '@/components/common/avatar/LazyAvatar.vue'
import RelationshipGalaxyThreeCanvas from '@/components/charts/relationship-galaxy/RelationshipGalaxyThreeCanvas.vue'
import { useDataService } from '@/services'
import { reportError } from '@/services/log-report'
import { buildGroupRelationshipGalaxyConnections } from './group-relationship-galaxy-view'

type GalaxyCanvasInstance = {
  focusNode: (key: string) => boolean
  fitView: () => void
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const { t, locale } = useI18n()
const dataService = useDataService()
const canvasRef = ref<GalaxyCanvasInstance | null>(null)
const galaxyData = ref<GroupRelationshipGalaxyData | null>(null)
const selectedKey = ref<string | null>(null)
const isLoading = ref(false)
const loadError = ref('')
const webglUnavailable = ref(false)
const isWideLayout = ref(false)
let requestId = 0
let detailMediaQuery: MediaQueryList | null = null

const selectedMember = computed(() => {
  if (!selectedKey.value) return null
  return galaxyData.value?.members.find((member) => member.key === selectedKey.value) ?? null
})
const connections = computed(() => buildGroupRelationshipGalaxyConnections(galaxyData.value, selectedKey.value))
const hasGraph = computed(() => (galaxyData.value?.graph.nodes.length ?? 0) > 0)
const safeInsetRight = computed(() => (selectedMember.value && isWideLayout.value ? 392 : 0))
const numberFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1, notation: 'compact' })
)
const dateFormatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'short', day: 'numeric' })
)

async function loadData() {
  if (!props.sessionId) return
  const currentRequestId = ++requestId
  isLoading.value = true
  loadError.value = ''
  webglUnavailable.value = false
  selectedKey.value = null

  try {
    const result = await dataService.getGroupRelationshipGalaxy(props.sessionId, props.timeFilter)
    if (currentRequestId !== requestId) return
    galaxyData.value = result
  } catch (error) {
    if (currentRequestId !== requestId) return
    const message = error instanceof Error ? error.message : String(error)
    loadError.value = message
    galaxyData.value = null
    reportError(`Group relationship galaxy load failed: ${message}`, error instanceof Error ? error.stack : undefined)
  } finally {
    if (currentRequestId === requestId) isLoading.value = false
  }
}

async function selectNode(node: RelationshipGalaxyRenderNode) {
  selectedKey.value = node.key
  await nextTick()
  canvasRef.value?.focusNode(node.key)
}

async function selectMember(member: GroupRelationshipGalaxyMemberDetail) {
  selectedKey.value = member.key
  await nextTick()
  canvasRef.value?.focusNode(member.key)
}

function clearSelection() {
  selectedKey.value = null
}

async function resetView() {
  selectedKey.value = null
  await nextTick()
  canvasRef.value?.fitView()
}

function handleCanvasFallback() {
  webglUnavailable.value = true
  selectedKey.value = null
}

function syncDetailLayout() {
  isWideLayout.value = detailMediaQuery?.matches ?? false
}

function avatarText(member: GroupRelationshipGalaxyMemberDetail): string {
  return (member.displayName || member.platformId || '?').slice(0, 1)
}

function formatNumber(value: number): string {
  return numberFormatter.value.format(value)
}

function formatScore(value: number): string {
  return `${Math.round(value * 100)}`
}

function formatTime(value: number | null): string {
  if (!value) return '—'
  return dateFormatter.value.format(new Date(value * 1000))
}

watch(
  () => [props.sessionId, props.timeFilter?.startTs, props.timeFilter?.endTs, props.timeFilter?.memberId],
  () => void loadData(),
  { immediate: true }
)

onMounted(() => {
  if (typeof window === 'undefined') return
  detailMediaQuery = window.matchMedia('(min-width: 768px)')
  syncDetailLayout()
  detailMediaQuery.addEventListener('change', syncDetailLayout)
})

onBeforeUnmount(() => {
  requestId++
  detailMediaQuery?.removeEventListener('change', syncDetailLayout)
})
</script>

<template>
  <div class="relative h-full min-h-[420px] w-full overflow-hidden bg-[#050302] text-white">
    <LoadingState v-if="isLoading" variant="page" :text="t('views.groupRelationshipGalaxy.loading')" />

    <div v-else-if="loadError" class="flex h-full items-center justify-center px-6 text-center">
      <div class="max-w-sm">
        <UIcon name="i-lucide-circle-alert" class="mx-auto h-10 w-10 text-rose-300" />
        <h3 class="mt-3 text-base font-semibold">{{ t('views.groupRelationshipGalaxy.loadFailed') }}</h3>
        <p class="mt-1 line-clamp-2 text-sm text-white/50">{{ loadError }}</p>
        <UButton class="mt-4" color="neutral" variant="soft" icon="i-lucide-refresh-cw" @click="loadData">
          {{ t('common.retry') }}
        </UButton>
      </div>
    </div>

    <div v-else-if="webglUnavailable" class="flex h-full items-center justify-center px-6 text-center">
      <div class="max-w-sm">
        <UIcon name="i-lucide-orbit" class="mx-auto h-11 w-11 text-amber-200/80" />
        <h3 class="mt-3 text-base font-semibold">{{ t('views.groupRelationshipGalaxy.webglUnavailable') }}</h3>
        <p class="mt-1 text-sm leading-6 text-white/50">
          {{ t('views.groupRelationshipGalaxy.webglUnavailableDescription') }}
        </p>
      </div>
    </div>

    <div v-else-if="!hasGraph" class="flex h-full items-center justify-center px-6 text-center">
      <div class="max-w-sm">
        <UIcon name="i-lucide-sparkles" class="mx-auto h-11 w-11 text-sky-200/70" />
        <h3 class="mt-3 text-base font-semibold">{{ t('views.groupRelationshipGalaxy.emptyTitle') }}</h3>
        <p class="mt-1 text-sm leading-6 text-white/50">
          {{ t('views.groupRelationshipGalaxy.emptyDescription') }}
        </p>
      </div>
    </div>

    <template v-else-if="galaxyData">
      <RelationshipGalaxyThreeCanvas
        ref="canvasRef"
        :graph="galaxyData.graph"
        :selected-key="selectedKey"
        :safe-inset-right="safeInsetRight"
        :label="t('views.groupRelationshipGalaxy.canvasLabel')"
        @clear-selection="clearSelection"
        @fallback="handleCanvasFallback"
        @select-node="selectNode"
      />

      <UButton
        icon="i-lucide-scan"
        color="neutral"
        variant="soft"
        size="xs"
        class="absolute left-4 top-4 z-20 border border-white/8 bg-black/25 text-white/75 backdrop-blur-md hover:bg-white/10 hover:text-white"
        :aria-label="t('views.groupRelationshipGalaxy.resetView')"
        @click="resetView"
      >
        {{ t('views.groupRelationshipGalaxy.resetView') }}
      </UButton>

      <aside
        v-if="selectedMember"
        class="dark absolute inset-x-3 bottom-3 z-20 flex max-h-[72vh] flex-col overflow-hidden rounded-2xl border border-white/8 bg-[#0b0c12]/88 text-white shadow-overlay backdrop-blur-xl md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:max-h-none md:w-[360px]"
      >
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          class="absolute right-2.5 top-2.5 z-10 text-white/60 hover:bg-white/8 hover:text-white"
          :aria-label="t('views.groupRelationshipGalaxy.closeDetail')"
          @click="clearSelection"
        />

        <div class="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4 pt-5">
          <header class="flex shrink-0 items-center gap-3 pr-8">
            <LazyAvatar
              :src="selectedMember.avatar"
              :alt="selectedMember.displayName"
              :text="avatarText(selectedMember)"
              root-class="h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-white/10"
              image-class="h-11 w-11 rounded-xl object-cover"
              fallback-class="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-400/12 text-sm font-bold text-sky-200"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <h3 class="truncate text-base font-semibold">{{ selectedMember.displayName }}</h3>
                <span class="rounded-full bg-white/8 px-2 py-0.5 font-mono text-[10px] text-white/55">
                  #{{ selectedMember.rank }}
                </span>
              </div>
              <p class="mt-0.5 truncate text-xs text-white/40">{{ selectedMember.platformId }}</p>
            </div>
          </header>

          <section class="grid shrink-0 grid-cols-3 gap-1.5">
            <div class="rounded-xl border border-white/6 bg-white/3 px-2.5 py-2">
              <p class="text-[9px] uppercase tracking-wider text-white/35">
                {{ t('views.groupRelationshipGalaxy.messageCount') }}
              </p>
              <p class="mt-1 font-mono text-sm font-semibold">{{ formatNumber(selectedMember.messageCount) }}</p>
            </div>
            <div class="rounded-xl border border-white/6 bg-white/3 px-2.5 py-2">
              <p class="text-[9px] uppercase tracking-wider text-white/35">
                {{ t('views.groupRelationshipGalaxy.relationshipScore') }}
              </p>
              <p class="mt-1 font-mono text-sm font-semibold text-sky-200">
                {{ formatScore(selectedMember.relationshipScore) }}
              </p>
            </div>
            <div class="rounded-xl border border-white/6 bg-white/3 px-2.5 py-2">
              <p class="text-[9px] uppercase tracking-wider text-white/35">
                {{ t('views.groupRelationshipGalaxy.lastInteraction') }}
              </p>
              <p class="mt-1 truncate text-xs font-semibold">{{ formatTime(selectedMember.lastInteractionTs) }}</p>
            </div>
          </section>

          <section class="shrink-0">
            <h4 class="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
              {{ t('views.groupRelationshipGalaxy.signalComposition') }}
            </h4>
            <div class="grid grid-cols-3 gap-1.5">
              <div class="rounded-xl bg-violet-400/8 px-2.5 py-2 text-violet-100">
                <p class="text-[10px] text-violet-100/50">{{ t('views.groupRelationshipGalaxy.replies') }}</p>
                <p class="mt-0.5 font-mono text-sm font-semibold">
                  {{ formatNumber(selectedMember.replyInteractionCount) }}
                </p>
              </div>
              <div class="rounded-xl bg-sky-400/8 px-2.5 py-2 text-sky-100">
                <p class="text-[10px] text-sky-100/50">{{ t('views.groupRelationshipGalaxy.mentions') }}</p>
                <p class="mt-0.5 font-mono text-sm font-semibold">
                  {{ formatNumber(selectedMember.mentionInteractionCount) }}
                </p>
              </div>
              <div class="rounded-xl bg-amber-300/8 px-2.5 py-2 text-amber-100">
                <p class="text-[10px] text-amber-100/50">{{ t('views.groupRelationshipGalaxy.proximity') }}</p>
                <p class="mt-0.5 font-mono text-sm font-semibold">
                  {{ formatNumber(selectedMember.coOccurrenceCount) }}
                </p>
              </div>
            </div>
          </section>

          <section class="flex min-h-0 flex-1 flex-col">
            <div class="mb-2 flex items-center justify-between">
              <h4 class="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                {{ t('views.groupRelationshipGalaxy.strongConnections') }}
              </h4>
              <span class="font-mono text-[10px] text-white/30">{{ connections.length }}</span>
            </div>

            <div v-if="connections.length" class="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
              <button
                v-for="connection in connections"
                :key="connection.edge.id"
                type="button"
                class="group flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2 py-2 text-left transition-colors hover:border-white/6 hover:bg-white/5"
                @click="selectMember(connection.member)"
              >
                <LazyAvatar
                  :src="connection.member.avatar"
                  :alt="connection.member.displayName"
                  :text="avatarText(connection.member)"
                  root-class="h-7 w-7 shrink-0 overflow-hidden rounded-lg border border-white/8"
                  image-class="h-7 w-7 rounded-lg object-cover"
                  fallback-class="flex h-7 w-7 items-center justify-center rounded-lg bg-white/6 text-[10px] font-semibold text-white/65"
                />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-xs font-semibold text-white/85 group-hover:text-white">
                    {{ connection.member.displayName }}
                  </p>
                  <p class="mt-0.5 truncate text-[10px] text-white/35">
                    {{
                      t('views.groupRelationshipGalaxy.connectionSignals', {
                        replies: connection.edge.replyInteractionCount,
                        mentions: connection.edge.mentionInteractionCount,
                        proximity: connection.edge.coOccurrenceCount,
                      })
                    }}
                  </p>
                </div>
                <span class="shrink-0 font-mono text-xs font-semibold text-sky-200/80">
                  {{ formatNumber(connection.edge.weight) }}
                </span>
              </button>
            </div>
            <p v-else class="py-5 text-center text-xs text-white/35">
              {{ t('views.groupRelationshipGalaxy.noConnections') }}
            </p>
          </section>
        </div>
      </aside>
    </template>
  </div>
</template>
