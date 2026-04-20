<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SubTabs } from '@/components/UI'
import UserSelect from '@/components/common/UserSelect.vue'
import MessageView from '@openchatlab/chart-message/MessageView.vue'
import InteractionView from '@openchatlab/chart-interaction/InteractionView.vue'
import RankingView from '@openchatlab/chart-ranking/RankingView.vue'
import Relationships from './view/Relationships.vue'
import ClusterView from '@openchatlab/chart-cluster/ClusterView.vue'
import { WordcloudTab, CatchphraseTab, HotRepeatTab } from '@/components/analysis/quotes'
import { isFeatureSupported, type LocaleType } from '@/i18n'

const { t, locale } = useI18n()

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  sessionName?: string
  timeFilter?: TimeFilter
}>()

// 子 Tab 配置（群聊专属：包含互动分析和榜单）
const subTabs = computed(() => {
  const tabs = [
    { id: 'message', label: t('analysis.subTabs.view.message'), icon: 'i-heroicons-chat-bubble-left-right' },
    { id: 'topic', label: t('analysis.subTabs.view.topic'), icon: 'i-heroicons-cloud' },
    { id: 'interaction', label: t('analysis.subTabs.view.interaction'), icon: 'i-heroicons-arrows-right-left' },
    { id: 'relationships', label: t('analysis.subTabs.member.relationships'), icon: 'i-heroicons-heart' },
    { id: 'cluster', label: t('analysis.subTabs.member.cluster'), icon: 'i-heroicons-user-group' },
    { id: 'hot-repeat', label: t('analysis.subTabs.quotes.hotRepeat'), icon: 'i-heroicons-fire' },
    {
      id: 'catchphrase',
      label: t('analysis.subTabs.quotes.catchphrase'),
      icon: 'i-heroicons-chat-bubble-bottom-center-text',
    },
  ]
  // 榜单仅在中文下显示
  if (isFeatureSupported('groupRanking', locale.value as LocaleType)) {
    tabs.splice(1, 0, { id: 'ranking', label: t('analysis.subTabs.view.ranking'), icon: 'i-heroicons-trophy' })
  }
  return tabs
})

const activeSubTab = ref('message')

// 成员筛选
const selectedMemberId = ref<number | null>(null)

// 构建 timeFilter（含 memberId）
const viewTimeFilter = computed(() => ({
  ...props.timeFilter,
  memberId: selectedMemberId.value,
}))
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 子 Tab 导航（右侧插槽放成员筛选） -->
    <SubTabs v-model="activeSubTab" :items="subTabs" persist-key="groupViewTab">
      <template #right>
        <UserSelect v-if="activeSubTab !== 'topic'" v-model="selectedMemberId" :session-id="props.sessionId" />
      </template>
    </SubTabs>

    <!-- 子 Tab 内容 -->
    <div class="flex-1 min-h-0 overflow-y-auto">
      <Transition name="fade" mode="out-in">
        <MessageView
          v-if="activeSubTab === 'message'"
          :session-id="props.sessionId"
          :session-name="props.sessionName"
          :time-filter="viewTimeFilter"
        />
        <WordcloudTab
          v-else-if="activeSubTab === 'topic'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
        />
        <InteractionView
          v-else-if="activeSubTab === 'interaction'"
          :session-id="props.sessionId"
          :time-filter="viewTimeFilter"
        />
        <Relationships
          v-else-if="activeSubTab === 'relationships'"
          :session-id="props.sessionId"
          :time-filter="viewTimeFilter"
        />
        <ClusterView
          v-else-if="activeSubTab === 'cluster'"
          :session-id="props.sessionId"
          :time-filter="viewTimeFilter"
        />
        <RankingView
          v-else-if="activeSubTab === 'ranking'"
          :session-id="props.sessionId"
          :time-filter="viewTimeFilter"
        />
        <HotRepeatTab
          v-else-if="activeSubTab === 'hot-repeat'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
        />
        <CatchphraseTab
          v-else-if="activeSubTab === 'catchphrase'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
        />
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
