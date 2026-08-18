<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    text: string
    followEnd?: boolean
  }>(),
  {
    followEnd: false,
  }
)

const el = ref<HTMLSpanElement | null>(null)
let pendingFrame: number | null = null

function align() {
  const element = el.value
  if (!element) return
  element.scrollLeft = props.followEnd ? Math.max(0, element.scrollWidth - element.clientWidth) : 0
}

function scheduleAlign() {
  if (pendingFrame !== null) return
  let remainingFrames = 3
  const advance = () => {
    remainingFrames -= 1
    if (remainingFrames > 0) {
      pendingFrame = requestAnimationFrame(advance)
      return
    }
    pendingFrame = null
    align()
  }
  pendingFrame = requestAnimationFrame(advance)
}

watch(
  () => [props.text, props.followEnd] as const,
  async () => {
    await nextTick()
    scheduleAlign()
  },
  { flush: 'post', immediate: true }
)

onBeforeUnmount(() => {
  if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
})
</script>

<template>
  <span
    ref="el"
    class="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-gray-400 dark:text-gray-500"
    :class="[props.followEnd ? '' : 'text-ellipsis']"
    :data-follow-end="props.followEnd || undefined"
  >
    {{ props.text }}
  </span>
</template>
