<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue'
import { PageAnchorsNav, TopNSelect } from '@/components/UI'
import { usePageAnchors } from '@/composables'
import { useDataService } from '@/services/data/service'
import type { MemberActivity } from '@/types/analysis'
import type { TimeFilter } from '@openchatlab/shared-types'
import { RANKING_LAYOUTS, RANKING_WIDTH_MODE_KEY, type RankingWidthMode } from '@/utils/rankingChartLayout'
import { ActivityRank, CheckInRank, MemeBattleRank, RepeatSection, DivingRank, NightOwlRank } from './sections'

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const memberActivity = ref<MemberActivity[]>([])
const availableYears = ref<number[]>([])

async function loadBaseData() {
  if (!props.sessionId) return

  const dataService = useDataService()
  const [members, years] = await Promise.all([
    dataService.getMemberActivity(props.sessionId, props.timeFilter),
    dataService.getAvailableYears(props.sessionId),
  ])
  memberActivity.value = members
  availableYears.value = years
}

watch(
  () => [props.sessionId, props.timeFilter],
  () => loadBaseData(),
  { immediate: true, deep: true }
)

const seasonTitle = computed(() => {
  if (props.timeFilter?.startTs && props.timeFilter?.endTs) {
    const startYear = new Date(props.timeFilter.startTs * 1000).getFullYear()
    const endYear = new Date(props.timeFilter.endTs * 1000).getFullYear()
    return startYear === endYear ? `${startYear} 赛季` : `${startYear}-${endYear} 赛季`
  }

  if (availableYears.value.length > 0) {
    const sorted = [...availableYears.value].sort((a, b) => a - b)
    const minYear = sorted[0]
    const maxYear = sorted[sorted.length - 1]
    return minYear === maxYear ? `${minYear} 赛季` : `${minYear}-${maxYear} 赛季`
  }

  return '全部赛季'
})

const rankingTimeFilter = computed(() => ({
  startTs: props.timeFilter?.startTs,
  endTs: props.timeFilter?.endTs,
}))

const anchors = [
  { id: 'activity-rank', label: '🏆 活跃榜' },
  { id: 'streak-rank', label: '🔥 火花榜' },
  { id: 'meme-battle', label: '⚔️ 斗图榜' },
  { id: 'repeat', label: '🔁 复读榜' },
  { id: 'night-owl', label: '⏰ 出勤榜' },
  { id: 'diving', label: '🤿 潜水榜' },
]

const { contentRef, activeAnchor, scrollToAnchor } = usePageAnchors(anchors, { threshold: 350 })
void contentRef

const globalTopN = ref(10)
const widthMode = ref<RankingWidthMode>('standard')
provide(RANKING_WIDTH_MODE_KEY, widthMode)

const widthModeOptions: Array<{ value: RankingWidthMode; label: string }> = [
  { value: 'standard', label: '标准' },
  { value: 'wide', label: '宽屏' },
  { value: 'full', label: '全宽' },
]

const mainContentClass = computed(() => RANKING_LAYOUTS[widthMode.value].contentClass)
</script>

<template>
  <div ref="contentRef" class="flex gap-6 p-6">
    <div class="main-content mx-auto min-w-0 flex-1 space-y-6 px-8" :class="mainContentClass">
      <div class="mb-8 mt-4">
        <h1
          class="text-5xl tracking-wider"
          style="
            font-weight: 800;
            background: linear-gradient(to right, #f59e0b, #ec4899, #9333ea);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          "
        >
          🏆 {{ seasonTitle }}
        </h1>
        <p class="mt-4 text-sm text-gray-500 dark:text-gray-400">各榜单前三名请找群主领取奖励 🎁</p>
      </div>

      <div id="activity-rank" class="scroll-mt-24">
        <ActivityRank
          :session-id="props.sessionId"
          :member-activity="memberActivity"
          :time-filter="rankingTimeFilter"
          :global-top-n="globalTopN"
        />
      </div>

      <CheckInRank :session-id="props.sessionId" :time-filter="rankingTimeFilter" :global-top-n="globalTopN" />

      <div id="meme-battle" class="scroll-mt-24">
        <MemeBattleRank :session-id="props.sessionId" :time-filter="rankingTimeFilter" :global-top-n="globalTopN" />
      </div>

      <div id="repeat" class="scroll-mt-24">
        <RepeatSection :session-id="props.sessionId" :time-filter="rankingTimeFilter" :global-top-n="globalTopN" />
      </div>

      <div id="night-owl" class="scroll-mt-24">
        <NightOwlRank :session-id="props.sessionId" :time-filter="rankingTimeFilter" :global-top-n="globalTopN" />
      </div>

      <div id="diving" class="scroll-mt-24">
        <DivingRank :session-id="props.sessionId" :time-filter="rankingTimeFilter" :global-top-n="globalTopN" />
      </div>

      <div class="h-48 no-capture" />
    </div>

    <PageAnchorsNav :anchors="anchors" :active-anchor="activeAnchor" @click="scrollToAnchor">
      <div class="border-l border-gray-200 pl-4 dark:border-gray-800">
        <div class="mb-2 text-xs text-gray-400">显示数量</div>
        <TopNSelect v-model="globalTopN" />
      </div>
      <div class="mt-4 border-l border-gray-200 pl-4 dark:border-gray-800">
        <div class="mb-2 text-xs text-gray-400">榜单宽度</div>
        <div
          class="flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs dark:border-gray-700 dark:bg-page-dark"
        >
          <button
            v-for="option in widthModeOptions"
            :key="option.value"
            type="button"
            class="rounded-md px-2 py-1 transition"
            :class="
              widthMode === option.value
                ? 'bg-pink-500 text-white shadow-sm'
                : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
            "
            @click="widthMode = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
    </PageAnchorsNav>
  </div>
</template>
