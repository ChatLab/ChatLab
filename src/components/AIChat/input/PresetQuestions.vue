<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  questions: string[]
  disabled?: boolean
  leadingActionLabel?: string
}>()

const emit = defineEmits<{
  select: [question: string]
  leadingAction: []
  editQuestions: []
}>()

const showPanel = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null

const chipClass =
  'rounded-full ring-1 ring-inset ring-gray-200/80 bg-white/60 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] backdrop-blur-md px-3 py-1.5 text-xs text-gray-600 transition-all duration-300 hover:-translate-y-[1px] hover:ring-primary-300 hover:bg-white/90 hover:text-primary-600 hover:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.08)] disabled:cursor-not-allowed disabled:opacity-50 dark:ring-gray-700/60 dark:bg-gray-800/60 dark:text-gray-300 dark:hover:ring-primary-500/50 dark:hover:bg-gray-800/90 dark:hover:text-primary-400'

function handleSelectQuestion(question: string) {
  showPanel.value = false
  emit('select', question)
}

function openPanel() {
  if (props.disabled || props.questions.length === 0) return
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  showPanel.value = true
}

function scheduleClose() {
  hideTimer = setTimeout(() => {
    showPanel.value = false
  }, 150)
}

function handleEditQuestions() {
  showPanel.value = false
  emit('editQuestions')
}

onBeforeUnmount(() => {
  if (hideTimer) clearTimeout(hideTimer)
})
</script>

<template>
  <div v-if="leadingActionLabel || questions.length > 0" class="relative">
    <div class="relative z-10 flex flex-nowrap gap-2">
      <button v-if="leadingActionLabel" :class="chipClass" :disabled="props.disabled" @click="emit('leadingAction')">
        {{ leadingActionLabel }}
      </button>

      <div v-if="questions.length > 0" class="relative shrink-0" @mouseenter="openPanel" @mouseleave="scheduleClose">
        <button
          :class="[
            chipClass,
            showPanel
              ? 'ring-primary-300 bg-white/90 text-primary-600 dark:ring-primary-500/50 dark:bg-gray-800/90 dark:text-primary-400'
              : '',
          ]"
          :disabled="props.disabled"
        >
          <span class="inline-flex items-center gap-1">
            <UIcon name="i-heroicons-chat-bubble-left-ellipsis" class="h-3.5 w-3.5" />
            {{ t('ai.chat.input.quickAsk') }}
          </span>
        </button>

        <Transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="opacity-0 translate-y-2"
          enter-to-class="opacity-100 translate-y-0"
          leave-active-class="transition duration-150 ease-in"
          leave-from-class="opacity-100 translate-y-0"
          leave-to-class="opacity-0 translate-y-2"
        >
          <div v-if="showPanel" class="absolute left-0 bottom-full z-20 mb-2 w-[320px] max-w-[calc(100vw-3rem)]">
            <div class="mb-1.5 flex justify-start">
              <button
                class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-gray-400 transition-colors hover:text-primary-500 dark:text-gray-500 dark:hover:text-primary-400"
                @click="handleEditQuestions"
              >
                <UIcon name="i-heroicons-pencil-square" class="h-3 w-3" />
                {{ t('ai.chat.input.editQuickAsk') }}
              </button>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="(question, index) in questions"
                :key="index"
                :class="chipClass"
                :disabled="props.disabled"
                @click="handleSelectQuestion(question)"
              >
                {{ question }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>
