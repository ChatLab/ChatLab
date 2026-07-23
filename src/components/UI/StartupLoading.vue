<script setup lang="ts">
import logoSvg from '@/assets/images/logo.svg'
</script>

<template>
  <div
    class="startup-loader flex h-full w-full items-center justify-center overflow-hidden"
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
        <span class="startup-loader__name text-gray-900 dark:text-white">ChatLab</span>
      </div>
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
  animation: startup-loader-scan 2.8s ease-in-out infinite;
  animation-delay: -0.8s;
}

.startup-loader__brand {
  display: flex;
  align-items: center;
  gap: 0.875rem;
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
  animation: startup-loader-breathe 2.8s ease-in-out infinite;
  animation-delay: -0.8s;
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
  animation: startup-loader-name 2.8s cubic-bezier(0.22, 1, 0.36, 1) infinite;
  animation-delay: -0.8s;
  font-size: 1.25rem;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: -0.02em;
}

@keyframes startup-loader-name {
  0%,
  12% {
    opacity: 0;
    transform: translateX(1.75rem);
  }

  26%,
  76% {
    opacity: 1;
    transform: translateX(0);
  }

  90%,
  100% {
    opacity: 0;
    transform: translateX(-0.375rem);
  }
}

@keyframes startup-loader-scan {
  0%,
  10% {
    opacity: 0;
    transform: translateX(-35%);
  }

  38%,
  68% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translateX(35%);
  }
}

@keyframes startup-loader-breathe {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.88);
  }

  48% {
    opacity: 1;
    transform: scale(1.08);
  }
}

@media (prefers-reduced-motion: reduce) {
  .startup-loader__glow,
  .startup-loader__logo-wrap::before,
  .startup-loader__name {
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
