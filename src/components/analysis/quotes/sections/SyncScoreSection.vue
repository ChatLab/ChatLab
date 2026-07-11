<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ThemeCard } from '@/components/UI'
import type { SharedWord } from '@/types/quotes/languagePreference'

const { t } = useI18n()

const props = defineProps<{
  sharedWords: SharedWord[]
}>()

const emit = defineEmits<{
  wordClick: [word: string]
}>()

const displayWords = computed(() => props.sharedWords.slice(0, 20))

const TAG_CLASSES = [
  'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:ring-indigo-500/30',
  'bg-pink-50 text-pink-600 ring-1 ring-pink-500/20 dark:bg-pink-500/10 dark:text-pink-400 dark:ring-pink-500/30',
  'bg-orange-50 text-orange-600 ring-1 ring-orange-500/20 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-orange-500/30',
  'bg-green-50 text-green-600 ring-1 ring-green-500/20 dark:bg-green-500/10 dark:text-green-400 dark:ring-green-500/30',
  'bg-blue-50 text-blue-600 ring-1 ring-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/30',
  'bg-violet-50 text-violet-600 ring-1 ring-violet-500/20 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/30',
  'bg-teal-50 text-teal-600 ring-1 ring-teal-500/20 dark:bg-teal-500/10 dark:text-teal-400 dark:ring-teal-500/30',
  'bg-rose-50 text-rose-600 ring-1 ring-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/30',
  'bg-yellow-50 text-yellow-600 ring-1 ring-yellow-500/20 dark:bg-yellow-500/10 dark:text-yellow-400 dark:ring-yellow-500/30',
  'bg-cyan-50 text-cyan-600 ring-1 ring-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-400 dark:ring-cyan-500/30',
]
</script>

<template>
  <ThemeCard>
    <div class="px-5 py-4 sm:px-6">
      <div class="mb-4 flex items-center gap-2">
        <UIcon name="i-heroicons-link" class="h-4 w-4 text-emerald-500" />
        <span class="text-[15px] font-black tracking-tight text-gray-900 dark:text-white">
          {{ t('quotes.topicProfile.sharedTopics') }}
        </span>
      </div>

      <div v-if="displayWords.length > 0" class="flex flex-wrap justify-center gap-2">
        <span
          v-for="(w, idx) in displayWords"
          :key="w.word"
          class="cursor-pointer rounded-full px-3 py-1 text-xs font-bold transition-opacity hover:opacity-80"
          :class="TAG_CLASSES[idx % TAG_CLASSES.length]"
          @click="emit('wordClick', w.word)"
        >
          {{ w.word }}
        </span>
      </div>
      <div v-else class="py-4 text-center text-sm text-gray-400">-</div>
    </div>
  </ThemeCard>
</template>
