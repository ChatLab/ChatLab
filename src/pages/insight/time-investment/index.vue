<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <main class="flex min-h-0 flex-1 items-center justify-center px-6 py-12">
    <div class="text-center text-sm text-gray-500 dark:text-gray-400">
      <UIcon name="i-lucide-clock-3" class="mx-auto mb-3 h-8 w-8 text-pink-500" />
      <p>{{ t('insight.reserved') }}</p>
    </div>
  </main>
</template>
