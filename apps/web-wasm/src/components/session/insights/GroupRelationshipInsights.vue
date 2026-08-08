<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { SectionTabs } from '@/components/navigation'
import ClusterView from '@/components/analysis/relationships/ClusterView.vue'
import GroupRelationshipGalaxyView from '@/components/analysis/relationships/GroupRelationshipGalaxyView.vue'
import MentionRankingView from '@/components/analysis/relationships/MentionRankingView.vue'
import type { TimeFilter } from '@openchatlab/shared-types'
import { getProximityTimeFilter } from './group-relationship-filter'

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const { t } = useI18n()
const activeSubTab = ref('relationship-galaxy')
const proximityTimeFilter = computed(() => getProximityTimeFilter(props.timeFilter))
const subTabs = computed(() => [
  {
    id: 'relationship-galaxy',
    label: t('analysis.subTabs.groupRelationships.relationshipGalaxy'),
    icon: 'i-lucide-orbit',
  },
  {
    id: 'mention-ranking',
    label: t('analysis.subTabs.groupRelationships.mentionRanking'),
    icon: 'i-heroicons-heart',
  },
  {
    id: 'proximity',
    label: t('analysis.subTabs.groupRelationships.proximity'),
    icon: 'i-heroicons-user-group',
  },
])
</script>

<template>
  <div class="flex h-full flex-col">
    <SectionTabs v-model="activeSubTab" :items="subTabs" persist-key="webWasmGroupRelationshipsTab" />

    <div class="min-h-0 flex-1 overflow-y-auto">
      <Transition name="fade" mode="out-in">
        <GroupRelationshipGalaxyView
          v-if="activeSubTab === 'relationship-galaxy'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
        />
        <MentionRankingView
          v-else-if="activeSubTab === 'mention-ranking'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
        />
        <ClusterView
          v-else-if="activeSubTab === 'proximity'"
          :session-id="props.sessionId"
          :time-filter="proximityTimeFilter"
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
