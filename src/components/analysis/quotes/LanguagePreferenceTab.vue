<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LanguagePreferenceResult } from '@/types/quotes/languagePreference'
import { useDataService } from '@/services'
import { LoadingState, EmptyState } from '@/components/UI'
import { useLayoutStore } from '@/stores/layout'
import LanguagePreferenceCard from './LanguagePreferenceCard.vue'
import CatchphrasePKSection from './sections/CatchphrasePKSection.vue'
import PosPortraitSection from './sections/PosPortraitSection.vue'
import ModalParticleSection from './sections/ModalParticleSection.vue'
import PunctuationSection from './sections/PunctuationSection.vue'
import type { TimeFilter } from '@openchatlab/shared-types'

const { t, locale } = useI18n()
const layoutStore = useLayoutStore()

const props = withDefaults(
  defineProps<{
    sessionId: string
    timeFilter?: TimeFilter
    enableRecordNavigation?: boolean
  }>(),
  { enableRecordNavigation: true }
)

const data = ref<LanguagePreferenceResult | null>(null)
const isLoading = ref(false)

const hasData = computed(() => data.value && data.value.members.length >= 2)

async function loadData() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    data.value = await useDataService().getLanguagePreferenceAnalysis(props.sessionId, locale.value, props.timeFilter)
  } catch (error) {
    console.error('[LanguagePreferenceTab] Failed to load:', error)
  } finally {
    isLoading.value = false
  }
}

function handleWordClick(word: string) {
  if (!props.enableRecordNavigation) return
  layoutStore.openChatRecords({ keywords: [word] })
}

watch(
  () => [props.sessionId, props.timeFilter],
  () => loadData(),
  { immediate: true, deep: true }
)
</script>

<template>
  <div class="main-content mx-auto max-w-[920px] space-y-6 p-4 sm:p-6">
    <LoadingState v-if="isLoading" :text="t('quotes.languagePreference.loading')" />
    <EmptyState v-else-if="!hasData" :text="t('quotes.languagePreference.empty')" />

    <template v-else-if="data">
      <!-- Hero 卡片 -->
      <LanguagePreferenceCard
        :data="data"
        :enable-record-navigation="props.enableRecordNavigation"
        @word-click="handleWordClick"
      />

      <!-- Section 1: 口头禅 PK -->
      <CatchphrasePKSection
        :members="data.members"
        :enable-record-navigation="props.enableRecordNavigation"
        @word-click="handleWordClick"
      />

      <!-- Section 2: 词性图谱 -->
      <PosPortraitSection :members="data.members" />

      <!-- Section 3: 语气词画像 -->
      <ModalParticleSection :members="data.members" />

      <!-- Section 4: 标点性格 -->
      <PunctuationSection :members="data.members" />
    </template>
  </div>
</template>
