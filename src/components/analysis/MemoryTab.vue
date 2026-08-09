<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { SectionTabs } from '@/components/navigation'
import { ChatRecordWorkspace } from '@/components/common/ChatRecord'

const { t } = useI18n()

defineProps<{
  sessionId: string
  sessionName?: string
}>()

const activeSubTab = ref('records')
const subTabs = computed(() => [
  {
    id: 'records',
    label: t('analysis.memory.tabs.records'),
    icon: 'i-heroicons-chat-bubble-left-right',
  },
])
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <SectionTabs v-model="activeSubTab" :items="subTabs" persist-key="memoryTab" />

    <div class="min-h-0 flex-1 overflow-hidden">
      <ChatRecordWorkspace v-if="activeSubTab === 'records'" :key="sessionId" :session-id="sessionId" mode="page" />
    </div>
  </div>
</template>
