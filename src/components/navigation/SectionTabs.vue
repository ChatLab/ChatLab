<script setup lang="ts">
import NavigationTabsBase from './NavigationTabsBase.vue'
import type { NavigationTabItem } from './types'

defineProps<{
  items: NavigationTabItem[]
  persistKey?: string
}>()

const model = defineModel<string>({ required: true })
const emit = defineEmits<{
  change: [value: string]
}>()
</script>

<template>
  <NavigationTabsBase
    v-model="model"
    :items="items"
    :persist-key="persistKey"
    mode="section"
    size="sm"
    :bordered="false"
    @change="emit('change', $event)"
  >
    <template v-if="$slots.right" #right>
      <slot name="right" />
    </template>
  </NavigationTabsBase>
</template>
