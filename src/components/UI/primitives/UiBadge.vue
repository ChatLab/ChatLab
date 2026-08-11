<script setup lang="ts">
import { computed } from 'vue'
import { toNuxtUiColor } from './nuxt-ui-adapter'
import { usePrimitiveAttrs } from './primitive-contracts'
import type { UiBadgeVariant, UiSize, UiTone } from './types'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    tone?: UiTone
    variant?: UiBadgeVariant
    size?: UiSize
    label?: string | number
    icon?: string
    trailingIcon?: string
  }>(),
  {
    tone: 'neutral',
    variant: 'soft',
    size: 'md',
    label: undefined,
    icon: undefined,
    trailingIcon: undefined,
  }
)

const color = computed(() => toNuxtUiColor(props.tone))
const primitiveAttrs = usePrimitiveAttrs()
</script>

<template>
  <UBadge
    v-bind="primitiveAttrs"
    :color="color"
    :variant="variant"
    :size="size"
    :label="label"
    :icon="icon"
    :trailing-icon="trailingIcon"
  >
    <template v-if="$slots.leading" #leading>
      <slot name="leading" />
    </template>
    <template v-if="$slots.default" #default>
      <slot />
    </template>
    <template v-if="$slots.trailing" #trailing>
      <slot name="trailing" />
    </template>
  </UBadge>
</template>
