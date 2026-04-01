<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SubTabs } from '@/components/UI'
import MemberList from './member/MemberList.vue'
import NicknameHistory from './member/NicknameHistory.vue'
import Relationships from './member/Relationships.vue'
import ClusterView from '@openchatlab/chart-cluster/ClusterView.vue'

const { t } = useI18n()

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const emit = defineEmits<{
  'data-changed': []
}>()

// 子 Tab 配置
const subTabs = computed(() => [
  { id: 'list', label: t('analysis.subTabs.member.memberList'), icon: 'i-heroicons-users' },
  { id: 'relationships', label: t('analysis.subTabs.member.relationships'), icon: 'i-heroicons-heart' },
  { id: 'cluster', label: t('analysis.subTabs.member.cluster'), icon: 'i-heroicons-user-group' },
  { id: 'history', label: t('analysis.subTabs.member.nicknameHistory'), icon: 'i-heroicons-clock' },
])

const activeSubTab = ref('list')

function handleDataChanged() {
  emit('data-changed')
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 子 Tab 导航 -->
    <SubTabs v-model="activeSubTab" :items="subTabs" persist-key="memberTab" />

    <!-- 子 Tab 内容 -->
    <div class="flex-1 min-h-0 overflow-auto">
      <Transition name="fade" mode="out-in">
        <!-- 成员列表 -->
        <MemberList v-if="activeSubTab === 'list'" :session-id="props.sessionId" @data-changed="handleDataChanged" />

        <!-- 群关系 -->
        <Relationships
          v-else-if="activeSubTab === 'relationships'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
        />

        <!-- 小团体 -->
        <ClusterView
          v-else-if="activeSubTab === 'cluster'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
        />

        <!-- 昵称变更记录 -->
        <NicknameHistory v-else-if="activeSubTab === 'history'" :session-id="props.sessionId" />
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
