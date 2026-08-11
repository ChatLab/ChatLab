<script setup lang="ts">
import UiButton from './UiButton.vue'
import { usePrimitiveAttrs } from './primitive-contracts'
import type { UiButtonVariant, UiSize, UiTone } from './types'

defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    icon: string
    label: string
    tone?: UiTone
    variant?: UiButtonVariant
    size?: UiSize
    loading?: boolean
    disabled?: boolean
  }>(),
  {
    tone: 'neutral',
    variant: 'ghost',
    size: 'sm',
    loading: false,
    disabled: false,
  }
)

const emit = defineEmits<{
  click: [event: MouseEvent]
  focus: [event: FocusEvent]
  blur: [event: FocusEvent]
  keydown: [event: KeyboardEvent]
  keyup: [event: KeyboardEvent]
}>()

const primitiveAttrs = usePrimitiveAttrs()
</script>

<template>
  <UiButton
    v-bind="primitiveAttrs"
    :icon="icon"
    :accessible-label="label"
    :tone="tone"
    :variant="variant"
    :size="size"
    :loading="loading"
    :disabled="disabled"
    @click="emit('click', $event)"
    @focus="emit('focus', $event)"
    @blur="emit('blur', $event)"
    @keydown="emit('keydown', $event)"
    @keyup="emit('keyup', $event)"
  />
</template>
