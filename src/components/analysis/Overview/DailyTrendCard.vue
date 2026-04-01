<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { SectionCard } from '@/components/UI'
import { EChartLine } from '@/components/charts'
import type { EChartLineData } from '@/components/charts'
import type { DailyActivity } from '@/types/analysis'

const { t } = useI18n()

defineProps<{
  dailyActivity: DailyActivity[]
  dailyChartData: EChartLineData
}>()
</script>

<template>
  <SectionCard v-if="dailyActivity.length > 0" :title="t('analysis.overview.dailyTrend.title')" :show-divider="false">
    <div class="p-5">
      <EChartLine :data="dailyChartData" :height="288" />
    </div>
  </SectionCard>
</template>
