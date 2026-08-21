<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AIChatComposer from './AIChatComposer.vue'

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    status?: 'ready' | 'submitted' | 'streaming' | 'error'
    placeholder: string
  }>(),
  {
    disabled: false,
    status: 'ready',
  }
)

const emit = defineEmits<{
  send: [payload: { content: string }]
  stop: []
}>()

const { t } = useI18n()
const composerRef = ref<InstanceType<typeof AIChatComposer> | null>(null)
const inputValue = ref('')
const isComposing = ref(false)

function submit() {
  const content = inputValue.value.trim()
  if (!content || props.disabled) return
  emit('send', { content })
  inputValue.value = ''
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || isComposing.value) return
  event.preventDefault()
  submit()
}

function fillInput(content: string) {
  if (props.disabled) return
  inputValue.value = content
  nextTick(() => {
    composerRef.value?.focus('end')
  })
}

defineExpose({ fillInput })
</script>

<template>
  <div class="shrink-0 pt-2 pb-2">
    <div class="relative mx-auto w-full max-w-4xl">
      <AIChatComposer
        ref="composerRef"
        v-model="inputValue"
        :disabled="disabled"
        :status="status"
        :placeholder="placeholder"
        :send-button-title="inputValue.trim() ? t('ai.chat.input.send') : t('ai.chat.input.needQuestion')"
        @submit="submit"
        @stop="emit('stop')"
        @keydown="handleKeydown"
        @composition-start="isComposing = true"
        @composition-end="isComposing = false"
      />
    </div>
  </div>
</template>
