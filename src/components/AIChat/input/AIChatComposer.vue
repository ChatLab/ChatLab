<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    disabled?: boolean
    status?: 'ready' | 'submitted' | 'streaming' | 'error'
    placeholder: string
    sendButtonTitle: string
    activeSkillName?: string | null
  }>(),
  {
    disabled: false,
    status: 'ready',
    activeSkillName: null,
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  stop: []
  keydown: [event: KeyboardEvent]
  cursorChange: []
  compositionStart: []
  compositionEnd: []
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const canSubmit = computed(() => props.modelValue.trim().length > 0 && !props.disabled)

function syncHeight() {
  const textarea = textareaRef.value
  if (!textarea) return

  textarea.style.height = 'auto'
  const maxHeight = 192
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

function focus() {
  textareaRef.value?.focus()
}

function getSelection() {
  const fallback = props.modelValue.length
  return {
    start: textareaRef.value?.selectionStart ?? fallback,
    end: textareaRef.value?.selectionEnd ?? fallback,
  }
}

function setSelectionRange(start: number, end: number) {
  textareaRef.value?.setSelectionRange(start, end)
}

function updateValue(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}

watch(
  () => props.modelValue,
  async () => {
    await nextTick()
    syncHeight()
  }
)

onMounted(() => void nextTick(syncHeight))

defineExpose({ focus, getSelection, setSelectionRange, syncHeight })
</script>

<template>
  <div
    class="flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_2px_14px_rgba(0,0,0,0.04)] ring-1 ring-gray-200/60 transition-all dark:bg-page-dark dark:ring-white/5"
    :class="
      disabled
        ? 'bg-gray-50/50 dark:bg-page-dark/50'
        : 'focus-within:ring-primary-500/40 focus-within:shadow-[0_4px_20px_rgba(0,0,0,0.08)] dark:focus-within:ring-primary-500/40'
    "
  >
    <div class="relative px-4 pt-2.5 pb-2.5">
      <div class="flex items-start gap-2 pr-10">
        <div
          v-if="activeSkillName"
          class="inline-flex max-w-[180px] shrink-0 items-center rounded-md bg-primary-50 px-2 text-sm leading-6 font-medium text-primary-700 dark:bg-primary-500/10 dark:text-primary-400"
        >
          <span class="truncate">/{{ activeSkillName }}</span>
        </div>

        <textarea
          ref="textareaRef"
          :value="modelValue"
          rows="2"
          class="min-h-[48px] min-w-0 flex-1 resize-none border-0 bg-transparent px-0 py-0 text-sm leading-6 text-gray-900 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed disabled:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:text-gray-500"
          :disabled="disabled"
          :placeholder="placeholder"
          @input="updateValue"
          @keydown="emit('keydown', $event)"
          @click="emit('cursorChange')"
          @keyup="emit('cursorChange')"
          @select="emit('cursorChange')"
          @compositionstart="emit('compositionStart')"
          @compositionend="emit('compositionEnd')"
        />
      </div>

      <button
        v-if="status === 'streaming'"
        type="button"
        class="absolute right-3 bottom-2 flex h-7 w-7 items-center justify-center rounded-full bg-primary-500 text-white shadow-sm transition-colors hover:bg-primary-600"
        @click="emit('stop')"
      >
        <UIcon name="i-heroicons-stop-16-solid" class="h-3.5 w-3.5" />
      </button>

      <button
        v-else
        type="button"
        class="absolute right-3 bottom-2 flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200"
        :class="
          canSubmit
            ? 'bg-primary-500 text-white hover:bg-primary-600 shadow-sm'
            : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
        "
        :disabled="!canSubmit"
        :title="sendButtonTitle"
        @click="emit('submit')"
      >
        <UIcon name="i-heroicons-arrow-up-20-solid" class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>
