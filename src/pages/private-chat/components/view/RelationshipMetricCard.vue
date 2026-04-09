<script setup lang="ts">
import { computed, useSlots } from 'vue'

withDefaults(
  defineProps<{
    title: string
    iconName: string
    iconBgClass: string
    iconColorClass: string
    leftName?: string
    leftValue?: string | number
    rightName?: string
    rightValue?: string | number
    valueClass?: string
    description?: string
  }>(),
  {
    leftName: '—',
    leftValue: '--',
    rightName: '—',
    rightValue: '--',
    valueClass: 'text-gray-700 dark:text-gray-200',
    description: '',
  }
)

const slots = useSlots()
const hasHeaderExtra = computed(() => Boolean(slots['header-extra']))
</script>

<template>
  <div
    class="flex flex-col rounded-2xl bg-white p-4 ring-1 ring-gray-900/5 transition-colors dark:bg-transparent dark:ring-white/10"
  >
    <div class="mb-2 min-h-8">
      <div class="flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" :class="iconBgClass">
            <UIcon :name="iconName" class="h-3.5 w-3.5" :class="iconColorClass" />
          </div>
          <span class="truncate text-xs font-bold tracking-wide text-gray-900 dark:text-white">{{ title }}</span>
        </div>
        <div v-if="hasHeaderExtra" class="shrink-0">
          <slot name="header-extra" />
        </div>
      </div>
    </div>

    <div class="flex h-full flex-col">
      <div class="grid grid-cols-2 gap-2">
        <div class="flex min-w-0 flex-col items-center rounded-xl bg-white px-1 py-1.5 text-center dark:bg-transparent">
          <div class="w-full truncate text-[10px] font-semibold tracking-wide text-gray-500 dark:text-gray-400" :title="leftName">
            {{ leftName }}
          </div>
          <div class="mt-1 font-black font-mono leading-none tabular-nums" :class="valueClass">
            {{ leftValue }}
          </div>
        </div>
        <div class="flex min-w-0 flex-col items-center rounded-xl bg-white px-1 py-1.5 text-center dark:bg-transparent">
          <div class="w-full truncate text-[10px] font-semibold tracking-wide text-gray-500 dark:text-gray-400" :title="rightName">
            {{ rightName }}
          </div>
          <div class="mt-1 font-black font-mono leading-none tabular-nums" :class="valueClass">
            {{ rightValue }}
          </div>
        </div>
      </div>

      <p class="mt-auto pt-3 min-h-8 text-[10px] leading-relaxed text-gray-500 dark:text-gray-400 sm:min-h-6">
        {{ description }}
      </p>
    </div>
  </div>
</template>
