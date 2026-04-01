<script setup lang="ts">
/**
 * 截屏预览弹窗
 * 仅用于展示截图预览
 */
import { computed } from 'vue'

const props = defineProps<{
  open: boolean
  imageData: string | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
})

function closeModal() {
  isOpen.value = false
}
</script>

<template>
  <UModal v-model:open="isOpen" :ui="{ content: 'max-w-4xl z-100' }">
    <template #content>
      <div class="flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div class="flex items-center gap-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-pink-400 to-pink-600"
            >
              <UIcon name="i-heroicons-camera" class="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">截图预览</h2>
            </div>
          </div>
          <UButton icon="i-heroicons-x-mark" variant="ghost" color="neutral" size="sm" @click="closeModal" />
        </div>

        <!-- Image Preview -->
        <div class="bg-gray-100 p-4 dark:bg-gray-800">
          <div class="mx-auto max-h-[60vh] overflow-auto rounded-lg bg-white shadow-lg dark:bg-gray-900">
            <img v-if="imageData" :src="imageData" alt="截图预览" class="block w-full" />
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
