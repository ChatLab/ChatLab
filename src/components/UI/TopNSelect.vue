<script setup lang="ts">
/**
 * TopN 数量选择器
 * 用于控制排行榜显示的数量
 */
const modelValue = defineModel<number>({ default: 10 })

const options = [
  { label: 'Top 5', value: 5 },
  { label: 'Top 10', value: 10 },
  { label: 'Top 20', value: 20 },
  { label: 'Top 30', value: 30 },
  { label: 'Top 50', value: 50 },
  { label: 'Top 100', value: 100 },
]
</script>

<template>
  <USelect v-model="modelValue" :items="options" value-key="value" class="w-25" />
</template>
