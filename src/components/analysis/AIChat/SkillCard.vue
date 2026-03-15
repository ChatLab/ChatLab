<script setup lang="ts">
import type { SkillSummary } from '@/stores/skill'

defineProps<{
  skill: SkillSummary
  selected?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

function getChatScopeIcon(scope: string): string {
  if (scope === 'group') return 'i-heroicons-user-group'
  if (scope === 'private') return 'i-heroicons-user'
  return 'i-heroicons-globe-alt'
}
</script>

<template>
  <div
    class="group relative cursor-pointer rounded-lg border px-3 py-2 transition-all duration-150"
    :class="[
      disabled
        ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-50 dark:border-gray-700 dark:bg-gray-800/50'
        : selected
          ? 'border-primary-500 bg-primary-50 shadow-sm dark:border-primary-400 dark:bg-primary-950/30'
          : 'border-gray-200 bg-white hover:border-primary-300 hover:shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:hover:border-primary-600',
    ]"
    @click="!disabled && emit('select', skill.id)"
  >
    <div class="flex items-start gap-2">
      <UIcon :name="getChatScopeIcon(skill.chatScope)" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
      <div class="min-w-0 flex-1">
        <h4 class="truncate text-xs font-medium text-gray-900 dark:text-gray-100">
          {{ skill.name }}
        </h4>
        <p class="mt-0.5 line-clamp-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          {{ skill.description }}
        </p>
      </div>
    </div>
    <!-- Tags -->
    <div v-if="skill.tags.length" class="mt-1.5 flex flex-wrap gap-1">
      <span
        v-for="tag in skill.tags.slice(0, 3)"
        :key="tag"
        class="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400"
      >
        {{ tag }}
      </span>
    </div>
  </div>
</template>
