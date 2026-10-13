<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import TagInput from '@/components/common/TagInput.vue'

withDefaults(
  defineProps<{
    modelValue: string[]
    loading?: boolean
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  }>(),
  {
    loading: false,
    size: 'xs',
  }
)

defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

const { t } = useI18n()
</script>

<template>
  <TagInput
    :model-value="modelValue"
    :placeholder="t('members.list.aliasPlaceholder')"
    :loading="loading"
    :size="size"
    class="w-full"
    @update:model-value="$emit('update:modelValue', $event)"
  />
</template>
