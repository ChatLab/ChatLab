<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { SubTabs } from '@/components/UI'
import TableBrowser from './TableBrowser.vue'
import ToolTestTab from './ToolTestTab.vue'

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
}>()

const subTabs = [
  { id: 'sql-tables', label: t('analysis.debug.sqlTables'), icon: 'i-heroicons-table-cells' },
  { id: 'basic-tools', label: t('analysis.debug.basicTools'), icon: 'i-heroicons-wrench-screwdriver' },
]

const activeSubTab = ref('sql-tables')
</script>

<template>
  <div class="flex h-full flex-col">
    <SubTabs v-model="activeSubTab" :items="subTabs" persist-key="debugTab" />

    <div class="min-h-0 flex-1 overflow-hidden">
      <Transition name="fade" mode="out-in">
        <TableBrowser v-if="activeSubTab === 'sql-tables'" class="h-full" :session-id="props.sessionId" />
        <ToolTestTab v-else-if="activeSubTab === 'basic-tools'" class="h-full" :session-id="props.sessionId" />
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
