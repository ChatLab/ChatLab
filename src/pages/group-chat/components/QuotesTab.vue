<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SectionTabs } from '@/components/navigation'
import { CatchphraseTab, HotRepeatTab } from '@/components/analysis/quotes'
import type { TimeFilter } from '@openchatlab/shared-types'

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

// 子 Tab 配置
const subTabs = computed(() => [
  { id: 'hot-repeat', label: t('analysis.subTabs.quotes.hotRepeat'), icon: 'i-heroicons-fire' },
  {
    id: 'catchphrase',
    label: t('analysis.subTabs.quotes.catchphrase'),
    icon: 'i-heroicons-chat-bubble-bottom-center-text',
  },
])

const activeSubTab = ref('hot-repeat')
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 子 Tab 导航 -->
    <SectionTabs v-model="activeSubTab" :items="subTabs" persist-key="quotesTab" />

    <!-- 子 Tab 内容 -->
    <div class="flex-1 min-h-0 overflow-auto">
      <Transition name="fade" mode="out-in">
        <!-- 口头禅分析 -->
        <CatchphraseTab
          v-if="activeSubTab === 'catchphrase'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
        />

        <!-- 最火复读内容 -->
        <HotRepeatTab
          v-else-if="activeSubTab === 'hot-repeat'"
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
