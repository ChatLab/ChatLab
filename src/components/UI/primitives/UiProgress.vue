<script setup lang="ts">
import { computed } from 'vue'
import { assertProgressLabel, getUiProgressState, usePrimitiveAttrs } from './primitive-contracts'
import type { UiSize, UiTone } from './types'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    label: string
    value?: number | null
    max?: number
    tone?: UiTone
    size?: UiSize
    showValue?: boolean
    inverted?: boolean
    statusText?: string
  }>(),
  {
    value: null,
    max: 100,
    tone: 'primary',
    size: 'md',
    showValue: false,
    inverted: false,
    statusText: undefined,
  }
)

assertProgressLabel(props.label)

const primitiveAttrs = usePrimitiveAttrs()
const progressState = computed(() => getUiProgressState(props.value, props.max))
const roundedPercentage = computed(() =>
  progressState.value.percentage === null ? null : Math.round(progressState.value.percentage)
)
const valueText = computed(
  () => props.statusText ?? (roundedPercentage.value === null ? undefined : `${roundedPercentage.value}%`)
)
const barStyle = computed(() =>
  progressState.value.percentage === null ? undefined : { width: `${progressState.value.percentage}%` }
)
const sizeClass = computed(
  () =>
    ({
      xs: 'h-1',
      sm: 'h-1.5',
      md: 'h-2',
      lg: 'h-2.5',
      xl: 'h-3',
    })[props.size]
)
const toneClass = computed(
  () =>
    ({
      primary: 'bg-primary-500',
      neutral: 'bg-gray-500',
      success: 'bg-green-500',
      warning: 'bg-amber-500',
      danger: 'bg-red-500',
      info: 'bg-blue-500',
    })[props.tone]
)
</script>

<template>
  <div v-bind="primitiveAttrs" class="w-full">
    <div
      v-if="showValue && roundedPercentage !== null"
      class="mb-1 text-right text-xs text-gray-500 dark:text-gray-400"
    >
      <slot name="status" :value="progressState.value" :max="max" :percentage="roundedPercentage">
        {{ roundedPercentage }}%
      </slot>
    </div>
    <div
      role="progressbar"
      :aria-label="label"
      :aria-valuemin="0"
      :aria-valuemax="max"
      :aria-valuenow="progressState.value ?? undefined"
      :aria-valuetext="valueText"
      :aria-busy="progressState.value === null ? 'true' : undefined"
      class="flex w-full overflow-hidden rounded-full bg-gray-200 dark:bg-white/10"
      :class="[sizeClass, inverted ? 'justify-end' : undefined]"
    >
      <div
        class="h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none"
        :class="[
          toneClass,
          progressState.percentage === null ? 'w-1/2 animate-pulse motion-reduce:animate-none' : undefined,
        ]"
        :style="barStyle"
      />
    </div>
  </div>
</template>
