<script setup lang="ts">
import NavigationTabsBase from './NavigationTabsBase.vue'
import type { NavigationTabItem } from './types'

withDefaults(
  defineProps<{
    items: NavigationTabItem[]
    persistKey?: string
    orientation?: 'horizontal' | 'vertical'
    size?: 'sm' | 'md'
    bordered?: boolean
  }>(),
  {
    orientation: 'horizontal',
    size: 'md',
  }
)

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
    :orientation="orientation"
    :size="size"
    :bordered="bordered"
    mode="compact"
    @change="emit('change', $event)"
  >
    <template v-if="$slots.right" #right>
      <slot name="right" />
    </template>
  </NavigationTabsBase>
</template>
