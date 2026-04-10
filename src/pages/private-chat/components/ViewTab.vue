<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SubTabs } from '@/components/UI'
import UserSelect from '@/components/common/UserSelect.vue'
import MessageView from '@openchatlab/chart-message/MessageView.vue'
import RelationshipView from './view/RelationshipView.vue'

const { t } = useI18n()

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const subTabs = computed(() => [
  { id: 'relationship', label: t('analysis.subTabs.view.relationship'), icon: 'i-heroicons-heart' },
  { id: 'message', label: t('analysis.subTabs.view.message'), icon: 'i-heroicons-chat-bubble-left-right' },
])

const activeSubTab = ref('relationship')

// 成员筛选（仅用于消息视图）
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
    <SubTabs v-model="activeSubTab" :items="subTabs" persist-key="privateViewTab">
      <template #right>
        <UserSelect v-if="activeSubTab === 'message'" v-model="selectedMemberId" :session-id="props.sessionId" />
      </template>
    </SubTabs>

    <!-- 子 Tab 内容 -->
    <div class="flex-1 min-h-0 overflow-auto">
      <Transition name="fade" mode="out-in">
        <MessageView v-if="activeSubTab === 'message'" :session-id="props.sessionId" :time-filter="viewTimeFilter" />
        <RelationshipView
          v-else-if="activeSubTab === 'relationship'"
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
