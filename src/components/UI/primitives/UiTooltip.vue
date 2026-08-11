<script setup lang="ts">
import type { UiTooltipPlacement } from './types'

defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    text: string
    placement?: UiTooltipPlacement
    delay?: number
    disabled?: boolean
  }>(),
  {
    placement: 'bottom',
    delay: 300,
    disabled: false,
  }
)
</script>

<template>
  <slot v-if="disabled || !text" />
  <UTooltip v-else :text="text" :delay-duration="delay" :content="{ side: placement }">
    <slot />
  </UTooltip>
</template>
