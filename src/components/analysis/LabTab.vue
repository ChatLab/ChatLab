<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { SectionTabs } from '@/components/navigation'
import SQLLabTab from './SQLLabTab.vue'

const props = defineProps<{
  sessionId: string
  chatType?: 'group' | 'private'
}>()

const { t } = useI18n()

// 保留实验室二级导航容器，后续新增实验能力时只需扩展这里的配置与内容分支。
const subTabs = computed(() => [
  {
    id: 'sql-lab',
    label: t('ai.tab.sqlLab'),
    icon: 'i-heroicons-command-line',
  },
])

const activeSubTab = ref('sql-lab')
</script>

<template>
  <div class="flex h-full flex-col">
    <SectionTabs v-model="activeSubTab" :items="subTabs" persist-key="labTab" />

    <div class="min-h-0 flex-1 overflow-hidden">
      <Transition name="fade" mode="out-in">
        <SQLLabTab
          v-if="activeSubTab === 'sql-lab'"
          class="h-full"
          :session-id="props.sessionId"
          :chat-type="props.chatType"
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
