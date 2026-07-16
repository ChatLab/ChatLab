<script setup lang="ts">
import { ref } from 'vue'
import CaptureButton from '@/components/common/CaptureButton.vue'
import { SectionCard } from '@/components/UI'

defineProps<{
  title: string
  description?: string
  showViewAll: boolean
  viewAllLabel: string
  countLabel: string
}>()

const isOpen = ref(false)
const modalBodyRef = ref<HTMLElement | null>(null)
</script>

<template>
  <SectionCard :title="title" :description="description" :show-divider="false">
    <template #headerRight>
      <div class="flex items-center gap-2">
        <span
          class="shrink-0 whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-500 dark:bg-white/5 dark:text-gray-400"
        >
          {{ countLabel }}
        </span>
        <div class="no-capture">
          <slot name="headerRight" />
        </div>
      </div>
    </template>

    <div>
      <slot />
    </div>

    <div v-if="showViewAll" class="no-capture px-3 pb-3 pt-1">
      <UModal v-model:open="isOpen" :ui="{ content: 'md:w-full max-w-4xl' }">
        <UButton
          color="neutral"
          variant="ghost"
          class="w-full justify-center rounded-lg py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400"
        >
          <span class="flex items-center gap-1.5">
            {{ viewAllLabel }}
            <UIcon name="i-heroicons-arrow-right" class="h-3.5 w-3.5" />
          </span>
        </UButton>
        <template #content>
          <div ref="modalBodyRef" class="section-content flex flex-col overflow-hidden">
            <div
              class="flex w-full items-center justify-between border-b border-gray-100 px-6 py-5 dark:border-white/5"
            >
              <div class="min-w-0">
                <h3 class="truncate text-base font-semibold text-gray-900 dark:text-white">{{ title }}</h3>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ countLabel }}</p>
              </div>
              <CaptureButton size="xs" type="element" :target-element="modalBodyRef" />
            </div>
            <div class="max-h-[70vh] overflow-y-auto">
              <slot name="full" />
            </div>
          </div>
        </template>
      </UModal>
    </div>
  </SectionCard>
</template>
