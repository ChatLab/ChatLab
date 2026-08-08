<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import logoSvg from '@/assets/images/logo.svg'
import { STARTUP_ANIMATION_DURATION_MS } from '@/bootstrap/startup-presentation'

const props = withDefaults(
  defineProps<{
    waiting?: boolean
    animated?: boolean
  }>(),
  {
    waiting: false,
    animated: true,
  }
)

const emit = defineEmits<{
  complete: []
}>()

const animationStyle = {
  '--startup-animation-duration': `${STARTUP_ANIMATION_DURATION_MS}ms`,
}

let completionTimer: number | null = null
let completed = false

function completeAnimation(): void {
  if (completed) return
  completed = true
  if (completionTimer !== null) {
    window.clearTimeout(completionTimer)
    completionTimer = null
  }
  emit('complete')
}

onMounted(() => {
  if (!props.animated || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    queueMicrotask(completeAnimation)
    return
  }

  // animationend 是主信号；定时器用于后台标签页等不会稳定派发动画事件的场景。
  completionTimer = window.setTimeout(completeAnimation, STARTUP_ANIMATION_DURATION_MS + 100)
})

onBeforeUnmount(() => {
  if (completionTimer !== null) window.clearTimeout(completionTimer)
})
</script>

<template>
  <div
    class="startup-loader flex h-full w-full items-center justify-center overflow-hidden"
    :class="{ 'startup-loader--static': !animated }"
    :style="animationStyle"
    role="status"
    aria-live="polite"
    aria-label="ChatLab"
  >
    <div class="startup-loader__stage">
      <div class="startup-loader__glow" aria-hidden="true"></div>
      <div class="startup-loader__brand">
        <span class="startup-loader__logo-wrap" aria-hidden="true">
          <img :src="logoSvg" alt="" class="startup-loader__logo" />
        </span>
        <span class="startup-loader__name text-gray-900 dark:text-white" @animationend="completeAnimation">
          ChatLab
        </span>
      </div>
      <span v-if="waiting" class="startup-loader__waiting" aria-hidden="true"></span>
    </div>
  </div>
</template>

<style scoped>
.startup-loader__stage {
  position: relative;
  display: flex;
  width: min(18rem, calc(100vw - 3rem));
  height: 6rem;
  align-items: center;
  justify-content: center;
  isolation: isolate;
}

.startup-loader__glow {
  position: absolute;
  z-index: -1;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in srgb, var(--color-pink-500) 7%, transparent) 34%,
    color-mix(in srgb, var(--color-pink-500) 18%, transparent) 50%,
    color-mix(in srgb, var(--color-pink-500) 7%, transparent) 66%,
    transparent 100%
  );
  filter: blur(18px);
  opacity: 0;
  transform: translateX(-35%);
  animation: startup-loader-scan var(--startup-animation-duration) ease-in-out both;
}

.startup-loader__brand {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  animation: startup-loader-logo var(--startup-animation-duration) cubic-bezier(0.22, 1, 0.36, 1) both;
}

.startup-loader__logo-wrap {
  position: relative;
  display: grid;
  width: 3.25rem;
  height: 3.25rem;
  flex: none;
  place-items: center;
}

.startup-loader__logo-wrap::before {
  position: absolute;
  inset: 0.375rem;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--color-pink-500) 18%, transparent);
  box-shadow: 0 0 26px color-mix(in srgb, var(--color-pink-500) 24%, transparent);
  content: '';
  filter: blur(8px);
  animation: startup-loader-breathe var(--startup-animation-duration) ease-in-out both;
}

.startup-loader__logo {
  position: relative;
  width: 2.5rem;
  height: 2.5rem;
  user-select: none;
  filter: drop-shadow(0 4px 10px color-mix(in srgb, var(--color-pink-500) 18%, transparent));
  pointer-events: none;
}

.startup-loader__name {
  animation: startup-loader-name var(--startup-animation-duration) cubic-bezier(0.22, 1, 0.36, 1) both;
  font-size: 1.25rem;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.startup-loader__waiting {
  position: absolute;
  bottom: 0.25rem;
  width: 0.875rem;
  height: 0.875rem;
  border: 2px solid color-mix(in srgb, var(--color-gray-400) 55%, transparent);
  border-top-color: transparent;
  border-radius: 9999px;
  animation: startup-loader-waiting 0.8s linear infinite;
}

.startup-loader--static .startup-loader__glow,
.startup-loader--static .startup-loader__brand,
.startup-loader--static .startup-loader__logo-wrap::before,
.startup-loader--static .startup-loader__name {
  animation: none;
}

.startup-loader--static .startup-loader__glow {
  opacity: 0.2;
  transform: translateX(35%);
}

.startup-loader--static .startup-loader__brand,
.startup-loader--static .startup-loader__name {
  opacity: 1;
  transform: none;
}

.startup-loader--static .startup-loader__logo-wrap::before {
  opacity: 0.62;
  transform: scale(1);
}

@keyframes startup-loader-logo {
  0%,
  10% {
    opacity: 0;
    transform: scale(0.88);
  }

  32%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes startup-loader-name {
  0%,
  14% {
    opacity: 0;
    transform: translateX(1.25rem);
  }

  32%,
  100% {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes startup-loader-scan {
  0%,
  10% {
    opacity: 0;
    transform: translateX(-35%);
  }

  36%,
  70% {
    opacity: 1;
  }

  100% {
    opacity: 0.2;
    transform: translateX(35%);
  }
}

@keyframes startup-loader-breathe {
  0%,
  12% {
    opacity: 0.55;
    transform: scale(0.88);
  }

  54% {
    opacity: 1;
    transform: scale(1.08);
  }

  100% {
    opacity: 0.62;
    transform: scale(1);
  }
}

@keyframes startup-loader-waiting {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .startup-loader__glow,
  .startup-loader__brand,
  .startup-loader__logo-wrap::before,
  .startup-loader__name,
  .startup-loader__waiting {
    animation: none;
  }

  .startup-loader__glow {
    opacity: 0.6;
    transform: none;
  }

  .startup-loader__name {
    opacity: 1;
    transform: none;
  }
}
</style>
