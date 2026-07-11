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
  <SectionCard :title="title" :description="description">
    <template #headerRight>
      <div class="no-capture flex items-center gap-2">
        <slot name="headerRight" />

        <UModal v-model:open="isOpen" :ui="{ content: 'md:w-full max-w-3xl' }">
          <UButton v-if="showViewAll" icon="i-heroicons-list-bullet" variant="ghost">
            {{ viewAllLabel }}
          </UButton>
          <template #content>
            <div ref="modalBodyRef" class="section-content flex flex-col">
              <div
                class="flex w-full items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700"
              >
                <div class="flex items-center gap-2">
                  <h3 class="text-lg font-semibold text-gray-900 whitespace-nowrap dark:text-white">{{ title }}</h3>
                  <span class="text-sm text-gray-500">（{{ countLabel }}）</span>
                </div>
                <CaptureButton size="xs" type="element" :target-element="modalBodyRef" />
              </div>
              <div class="max-h-[60vh] overflow-y-auto p-4">
                <slot name="full" />
              </div>
            </div>
          </template>
        </UModal>
      </div>
    </template>

    <slot />
  </SectionCard>
</template>
