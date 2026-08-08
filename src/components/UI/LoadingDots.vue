<template>
  <svg class="loading-dots" viewBox="0 0 35 14" width="35" height="14" aria-hidden="true" focusable="false">
    <circle class="loading-dots__dot fill-primary-500" cx="6" cy="8" r="2.5" />
    <circle class="loading-dots__dot fill-primary-500" cx="17.5" cy="8" r="2.5" />
    <circle class="loading-dots__dot fill-primary-500" cx="29" cy="8" r="2.5" />
  </svg>
</template>

<style scoped>
.loading-dots {
  display: block;
  overflow: visible;
}

.loading-dots__dot {
  opacity: 0.6;
  transform-box: fill-box;
  transform-origin: center;
  animation: loading-dot 760ms linear infinite;
}

.loading-dots__dot:nth-child(2) {
  animation-delay: 110ms;
}

.loading-dots__dot:nth-child(3) {
  animation-delay: 220ms;
}

@keyframes loading-dot {
  0%,
  100% {
    opacity: 0.6;
    transform: translateY(0);
  }

  18% {
    opacity: 0.6;
    transform: translateY(0);
    animation-timing-function: cubic-bezier(0.2, 0.75, 0.35, 1);
  }

  36% {
    opacity: 1;
    transform: translateY(-3px);
    animation-timing-function: cubic-bezier(0.35, 0, 0.25, 1);
  }

  62% {
    opacity: 0.6;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .loading-dots__dot {
    opacity: 0.8;
    animation: none;
  }
}
</style>
