<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLayoutStore } from '@/stores/layout'
import CaptureButton from '@/components/common/CaptureButton.vue'
import TimeSelect from '@/components/common/TimeSelect.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import { PageTabs } from '@/components/navigation'
import type { TimeRangeValue, TimeSelectState } from '@/components/common/TimeSelect.vue'

interface SessionAnalysisTab {
  id: string
  labelKey: string
  icon: string
}

const activeTab = defineModel<string>('activeTab', { required: true })
const timeRangeValue = defineModel<TimeRangeValue | null>('timeRangeValue', { required: true })

const props = defineProps<{
  title: string
  avatar?: string | null
  icon: string
  iconClass: string
  tabs: SessionAnalysisTab[]
  currentSessionId: string | null
  initialTimeState: Partial<TimeSelectState>
}>()

const emit = defineEmits<{
  (e: 'openIncrementalImport'): void
  (e: 'openMemberManagement'): void
  (e: 'openChatRecord'): void
  (e: 'update:fullRange', value: { start: number; end: number } | null): void
  (e: 'update:availableYears', value: number[]): void
}>()

const { t } = useI18n()
const layoutStore = useLayoutStore()

const timeSelectVisible = computed(() => !['ai-chat', 'memory', 'lab', 'debug'].includes(activeTab.value))
const navigationItems = computed(() =>
  props.tabs.map((tab) => ({
    id: tab.id,
    label: t(tab.labelKey),
    icon: tab.icon,
  }))
)
</script>

<template>
  <PageHeader :title="title" :avatar="avatar" size="compact" :icon="icon" :icon-class="iconClass">
    <template #actions>
      <template v-if="layoutStore.toolsPanelPosition === 'header'">
        <UTooltip :text="t('analysis.tooltip.viewChatRecord')">
          <UButton
            icon="i-heroicons-chat-bubble-bottom-center-text"
            variant="ghost"
            color="gray"
            size="sm"
            class="hover:bg-gray-100 dark:hover:bg-gray-800"
            @click="emit('openChatRecord')"
          />
        </UTooltip>
        <UTooltip :text="t('analysis.tooltip.incrementalImport')">
          <UButton
            icon="i-heroicons-plus-circle"
            variant="ghost"
            color="gray"
            size="sm"
            class="hover:bg-gray-100 dark:hover:bg-gray-800"
            @click="emit('openIncrementalImport')"
          />
        </UTooltip>
        <UTooltip :text="t('analysis.tooltip.memberManagement')">
          <UButton
            icon="i-heroicons-user-group"
            variant="ghost"
            color="gray"
            size="sm"
            class="hover:bg-gray-100 dark:hover:bg-gray-800"
            @click="emit('openMemberManagement')"
          />
        </UTooltip>
        <CaptureButton color="gray" />
        <UTooltip :text="t('analysis.tooltip.more')">
          <UButton
            data-tools-panel-trigger
            icon="i-heroicons-ellipsis-horizontal"
            variant="ghost"
            color="gray"
            size="sm"
            class="hover:bg-gray-100 dark:hover:bg-gray-800"
            @click="layoutStore.toggleToolsPanelOpen()"
          />
        </UTooltip>
      </template>
      <CaptureButton v-else color="gray" />
    </template>

    <div class="mt-3 flex items-center justify-between gap-3">
      <PageTabs v-model="activeTab" class="min-w-0 shrink" :items="navigationItems" />
      <!-- AI 对话和实验室都不使用这里的时间范围筛选，因此在这些一级 Tab 下隐藏。 -->
      <TimeSelect
        v-model="timeRangeValue"
        :session-id="currentSessionId ?? undefined"
        :visible="timeSelectVisible"
        :initial-state="initialTimeState"
        @update:full-range="emit('update:fullRange', $event)"
        @update:available-years="emit('update:availableYears', $event)"
      />
    </div>
  </PageHeader>
</template>
