<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { LoadingDots } from '@/components/UI'

const { t } = useI18n()
</script>

<template>
  <div class="flex h-56 items-center justify-center" role="status" aria-live="polite">
    <span class="sr-only">{{ t('common.loading') }}</span>
    <LoadingDots />
  </div>
</template>
