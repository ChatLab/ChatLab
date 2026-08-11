<script setup lang="ts">
import { computed } from 'vue'
import type { AnnualSummaryRange } from '@openchatlab/shared-types'
import { EChartBar } from '@/components/charts'
import type { AnnualSummaryTranslate } from '../../locales'

const props = defineProps<{
  t: AnnualSummaryTranslate
  range: AnnualSummaryRange
  data: Array<{ month: string; value: number }>
  height?: number
}>()

const chartData = computed(() => ({
  labels: props.data.map((item) =>
    props.range.mode === 'year'
      ? props.t('monthLabel', { month: Number(item.month.slice(5)) })
      : item.month.replace('-', '/')
  ),
  values: props.data.map((item) => item.value),
}))
</script>

<template>
  <EChartBar :data="chartData" :height="height ?? 260" :border-radius="3" />
</template>
