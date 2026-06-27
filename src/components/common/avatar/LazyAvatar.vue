<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createLazyAvatarObserver } from './lazy-avatar'

type AvatarClass = string | Record<string, boolean> | Array<string | Record<string, boolean>>

const props = withDefaults(
  defineProps<{
    src?: string | null
    alt: string
    text: string
    rootClass?: AvatarClass
    imageClass?: AvatarClass
    fallbackClass?: AvatarClass
    rootMargin?: string
  }>(),
  {
    src: null,
    rootClass: 'h-8 w-8 shrink-0',
    imageClass: 'h-8 w-8 rounded-full object-cover',
    fallbackClass: 'flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold',
    rootMargin: '160px 0px',
  }
)

const avatarRoot = ref<HTMLElement | null>(null)
const shouldLoadImage = ref(false)
let stopObserving: (() => void) | null = null

const hasAvatar = computed(() => Boolean(props.src))

function cleanupObserver() {
  stopObserving?.()
  stopObserving = null
}

function startObserver() {
  cleanupObserver()
  shouldLoadImage.value = false

  if (!props.src || !avatarRoot.value) return

  stopObserving = createLazyAvatarObserver(
    avatarRoot.value,
    () => {
      shouldLoadImage.value = true
    },
    {
      rootMargin: props.rootMargin,
    }
  )
}

onMounted(startObserver)

watch(
  () => props.src,
  () => {
    startObserver()
  }
)

onBeforeUnmount(cleanupObserver)
</script>

<template>
  <div ref="avatarRoot" :class="rootClass">
    <img
      v-if="hasAvatar && shouldLoadImage"
      :src="src!"
      :alt="alt"
      :class="imageClass"
      loading="lazy"
      decoding="async"
    />
    <div v-else :class="fallbackClass">
      {{ text }}
    </div>
  </div>
</template>
