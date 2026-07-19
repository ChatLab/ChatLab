<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { EChartBar, EChartPie, RankList } from '@/components/charts'
import PageHeader from '@/components/layout/PageHeader.vue'
import { LoadingState, SectionCard } from '@/components/UI'
import { useDataService } from '@/services'
import { useSessionStore } from '@/stores/session'
import type { HourlyActivity, MemberActivity } from '@/types/analysis'
import { getMessageTypeName, type AnalysisSession } from '@/types/base'
import type { MessageTypeStats } from '@openchatlab/core'
import { buildHourlyChartData, buildMemberRankItems, buildMessageTypeChartData } from './session-detail'

const { t } = useI18n()
const route = useRoute()
const sessionStore = useSessionStore()

const session = ref<AnalysisSession | null>(null)
const hourlyActivity = ref<HourlyActivity[]>([])
const memberActivity = ref<MemberActivity[]>([])
const messageTypes = ref<MessageTypeStats[]>([])
const isLoading = ref(true)
const loadFailed = ref(false)
let loadVersion = 0

const sessionId = computed(() => String(route.params.id ?? ''))
const isPrivateChat = computed(() => route.name === 'private-chat')
const chartData = computed(() => buildHourlyChartData(hourlyActivity.value))
const memberRankItems = computed(() => buildMemberRankItems(memberActivity.value))
const messageTypeChartData = computed(() =>
  buildMessageTypeChartData(messageTypes.value, (type) => getMessageTypeName(type, t))
)
const loadErrorText = computed(() =>
  t(isPrivateChat.value ? 'analysis.privateChat.loadError' : 'analysis.groupChat.loadError')
)

async function loadSessionDetail() {
  const id = sessionId.value
  const version = ++loadVersion

  if (!id) {
    session.value = null
    hourlyActivity.value = []
    memberActivity.value = []
    messageTypes.value = []
    loadFailed.value = true
    isLoading.value = false
    return
  }

  sessionStore.selectSession(id)
  session.value = null
  hourlyActivity.value = []
  memberActivity.value = []
  messageTypes.value = []
  loadFailed.value = false
  isLoading.value = true

  try {
    const data = useDataService()
    const [sessionData, hourlyData, memberData, messageTypeData] = await Promise.all([
      data.getSession(id),
      data.getHourlyActivity(id),
      data.getMemberActivity(id),
      data.getMessageTypeDistribution(id),
    ])
    if (version !== loadVersion) return

    session.value = sessionData
    hourlyActivity.value = hourlyData
    memberActivity.value = memberData
    messageTypes.value = messageTypeData
    loadFailed.value = sessionData === null
  } catch (error) {
    if (version !== loadVersion) return
    console.error('[web-wasm-session] Failed to load session detail:', error)
    loadFailed.value = true
  } finally {
    if (version === loadVersion) isLoading.value = false
  }
}

watch(sessionId, loadSessionDetail, { immediate: true })

onUnmounted(() => {
  loadVersion += 1
})
</script>

<template>
  <div class="flex h-full flex-col dark:bg-page-dark" style="padding-top: var(--titlebar-area-height)">
    <LoadingState v-if="isLoading" variant="page" :text="t('common.loading')" />

    <template v-else-if="session">
      <PageHeader
        :title="session.name"
        :avatar="session.groupAvatar"
        :icon="isPrivateChat ? 'i-heroicons-user' : 'i-heroicons-chat-bubble-left-right'"
        :icon-class="isPrivateChat ? 'bg-pink-600 dark:bg-pink-500' : 'bg-primary-600 dark:bg-primary-500'"
        size="compact"
      />

      <div class="flex-1 overflow-y-auto">
        <div class="main-content mx-auto max-w-[920px] space-y-6 p-4 sm:p-6">
          <UButton
            icon="i-heroicons-arrow-left"
            variant="ghost"
            color="gray"
            size="sm"
            :label="t('common.back')"
            to="/"
          />

          <div class="grid grid-cols-2 gap-3 sm:gap-4">
            <div class="rounded-xl border border-gray-200/60 bg-white p-4 dark:border-white/5 dark:bg-card-dark">
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('analysis.overview.identity.totalMessages') }}
              </p>
              <p class="mt-1 text-xl font-semibold tabular-nums text-gray-900 dark:text-white">
                {{ session.messageCount.toLocaleString() }}
              </p>
            </div>
            <div class="rounded-xl border border-gray-200/60 bg-white p-4 dark:border-white/5 dark:bg-card-dark">
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('views.cluster.totalMembers') }}
              </p>
              <p class="mt-1 text-xl font-semibold tabular-nums text-gray-900 dark:text-white">
                {{ session.memberCount.toLocaleString() }}
              </p>
            </div>
          </div>

          <SectionCard
            :title="t('analysis.overview.messageTypeDistribution')"
            :capturable="false"
            :show-divider="false"
          >
            <div class="p-3 sm:p-5">
              <EChartPie v-if="messageTypeChartData.values.length > 0" :data="messageTypeChartData" :height="280" />
              <div v-else class="py-8 text-center text-sm text-gray-400">
                {{ t('views.message.noData') }}
              </div>
            </div>
          </SectionCard>

          <SectionCard :title="t('analysis.overview.memberRanking')" :capturable="false" :show-divider="false">
            <RankList v-if="memberRankItems.length > 0" :members="memberRankItems" :rank-limit="10" show-avatar />
            <div v-else class="py-8 text-center text-sm text-gray-400">
              {{ t('views.message.noData') }}
            </div>
          </SectionCard>

          <SectionCard :title="t('views.message.hourlyDistribution')" :capturable="false" :show-divider="false">
            <div class="p-3 sm:p-5">
              <EChartBar :data="chartData" :height="260" />
            </div>
          </SectionCard>
        </div>
      </div>
    </template>

    <div v-else-if="loadFailed" class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p class="text-sm text-gray-500 dark:text-gray-400">{{ loadErrorText }}</p>
      <UButton size="sm" variant="soft" to="/">{{ t('common.back') }}</UButton>
    </div>
  </div>
</template>
