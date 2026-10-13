<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue: string[]
    placeholder?: string
    loading?: boolean
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  }>(),
  {
    placeholder: '',
    loading: false,
    size: 'xs',
  }
)

defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()
</script>

<template>
  <UInputTags
    :model-value="modelValue"
    :placeholder="placeholder"
    :loading="loading"
    :size="size"
    class="w-full"
    @update:model-value="$emit('update:modelValue', $event)"
  />
</template>
