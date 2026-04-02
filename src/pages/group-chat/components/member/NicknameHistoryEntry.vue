<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import NicknameHistory from './NicknameHistory.vue'

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
}>()

const isOpen = ref(false)
</script>

<template>
  <UButton variant="ghost" icon="i-heroicons-clock" size="sm" @click="isOpen = true">
    {{ t('analysis.subTabs.member.nicknameHistory') }}
  </UButton>

  <UModal v-if="props.sessionId" v-model:open="isOpen" :ui="{ content: 'max-w-6xl h-[85vh]' }">
    <template #content>
      <div class="flex h-full flex-col overflow-hidden bg-white dark:bg-gray-900">
        <div class="flex flex-none items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ t('analysis.subTabs.member.nicknameHistory') }}
          </h2>
          <UButton variant="ghost" icon="i-heroicons-x-mark" size="sm" @click="isOpen = false" />
        </div>
        <div class="flex-1 overflow-auto">
          <NicknameHistory :session-id="props.sessionId" />
        </div>
      </div>
    </template>
  </UModal>
</template>
