<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AnnualSummaryRange } from '@openchatlab/shared-types'
import { EChartBar } from '@/components/charts'

const props = defineProps<{
  range: AnnualSummaryRange
  data: Array<{ month: string; value: number }>
  height?: number
}>()
const { t } = useI18n()

const chartData = computed(() => ({
  labels: props.data.map((item) =>
    props.range.mode === 'year'
      ? t('insight.monthLabel', { month: Number(item.month.slice(5)) })
      : item.month.replace('-', '/')
  ),
  values: props.data.map((item) => item.value),
}))
</script>

<template>
  <EChartBar :data="chartData" :height="height ?? 260" :border-radius="3" />
</template>
