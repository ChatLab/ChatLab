<script setup lang="ts">
import { computed, useSlots } from 'vue'
import { toNuxtUiColor } from './nuxt-ui-adapter'
import { assertButtonAccessibleName, usePrimitiveAttrs } from './primitive-contracts'
import type { UiButtonVariant, UiSize, UiTone } from './types'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    tone?: UiTone
    variant?: UiButtonVariant
    size?: UiSize
    type?: 'button' | 'submit' | 'reset'
    label?: string
    accessibleLabel?: string
    icon?: string
    trailingIcon?: string
    loading?: boolean
    disabled?: boolean
    block?: boolean
  }>(),
  {
    tone: 'primary',
    variant: 'solid',
    size: 'md',
    type: 'button',
    label: undefined,
    accessibleLabel: undefined,
    icon: undefined,
    trailingIcon: undefined,
    loading: false,
    disabled: false,
    block: false,
  }
)

const emit = defineEmits<{
  click: [event: MouseEvent]
  focus: [event: FocusEvent]
  blur: [event: FocusEvent]
  keydown: [event: KeyboardEvent]
  keyup: [event: KeyboardEvent]
}>()

const slots = useSlots()
const primitiveAttrs = usePrimitiveAttrs(['aria-label', 'aria-busy'])
const color = computed(() => toNuxtUiColor(props.tone))
const resolvedAccessibleLabel = computed(() => {
  assertButtonAccessibleName({
    label: props.label,
    accessibleLabel: props.accessibleLabel,
    hasDefaultSlot: Boolean(slots.default),
  })
  return props.accessibleLabel
})
const isDisabled = computed(() => props.disabled || props.loading)
</script>

<template>
  <UButton
    v-bind="primitiveAttrs"
    :type="type"
    :label="label"
    :aria-label="resolvedAccessibleLabel"
    :aria-busy="loading ? 'true' : undefined"
    :icon="icon"
    :trailing-icon="trailingIcon"
    :color="color"
    :variant="variant"
    :size="size"
    :loading="loading"
    :disabled="isDisabled"
    :block="block"
    @click="emit('click', $event)"
    @focus="emit('focus', $event)"
    @blur="emit('blur', $event)"
    @keydown="emit('keydown', $event)"
    @keyup="emit('keyup', $event)"
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
  </UButton>
</template>
