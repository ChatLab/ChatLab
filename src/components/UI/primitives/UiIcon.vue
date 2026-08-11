<script setup lang="ts">
import { computed } from 'vue'
import { usePrimitiveAttrs } from './primitive-contracts'
import type { UiSize } from './types'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  name: string
  size?: UiSize
  label?: string
}>()

const sizeClass = computed(() => {
  if (!props.size) return undefined
  return {
    xs: 'h-3 w-3',
    sm: 'h-3.5 w-3.5',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
    xl: 'h-6 w-6',
  }[props.size]
})
const primitiveAttrs = usePrimitiveAttrs(['aria-label', 'aria-hidden', 'role'])
</script>

<template>
  <UIcon
    v-bind="primitiveAttrs"
    :name="name"
    :class="sizeClass"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
  />
</template>
