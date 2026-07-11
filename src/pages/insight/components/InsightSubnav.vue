<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  active: 'annual-summary' | 'time-investment' | 'relationship-changes'
}>()

const { t } = useI18n()
const items = computed(() => [
  {
    id: 'annual-summary' as const,
    label: t('insight.tabs.annualSummary'),
    icon: 'i-lucide-calendar-range',
    to: { name: 'insight-annual-summary' },
  },
  {
    id: 'time-investment' as const,
    label: t('insight.tabs.timeInvestment'),
    icon: 'i-lucide-clock-3',
    to: { name: 'insight-time-investment' },
  },
  {
    id: 'relationship-changes' as const,
    label: t('insight.tabs.relationshipChanges'),
    icon: 'i-lucide-git-compare-arrows',
    to: { name: 'insight-relationship-changes' },
  },
])
</script>

<template>
  <nav class="flex shrink-0 items-center gap-0.5 overflow-x-auto scrollbar-hide" :aria-label="t('insight.tabs.nav')">
    <RouterLink
      v-for="item in items"
      :key="item.id"
      :to="item.to"
      class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all"
      :class="
        props.active === item.id
          ? 'bg-pink-500 text-white dark:bg-pink-900/30 dark:text-pink-300'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white'
      "
    >
      <UIcon :name="item.icon" class="h-3.5 w-3.5" />
      <span class="whitespace-nowrap">{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>
