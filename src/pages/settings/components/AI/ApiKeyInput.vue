<script setup lang="ts">
import { ref, useAttrs, computed } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    label?: string
    optionalText?: string // 有值则显示 optional 标记
    hint?: string
    // 验证相关
    validateLoading?: boolean
    validateDisabled?: boolean
    validateText?: string
    validationResult?: 'idle' | 'valid' | 'invalid'
    validationMessage?: string
  }>(),
  {
    placeholder: '',
    label: 'API Key',
    optionalText: '',
    hint: '',
    validateLoading: false,
    validateDisabled: false,
    validateText: 'Validate',
    validationResult: 'idle',
    validationMessage: '',
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  validate: []
}>()

const attrs = useAttrs()

// 通过检测是否监听了 @validate 事件来决定是否显示验证按钮
const showValidateButton = computed(() => 'onValidate' in attrs)

// 控制明文/密文显示
const showPassword = ref(false)

function updateValue(value: string) {
  emit('update:modelValue', value)
}
</script>

<template>
  <div>
    <label v-if="label" class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
      {{ label }}
      <span v-if="optionalText" class="font-normal text-gray-400">{{ optionalText }}</span>
    </label>
    <div class="flex gap-2">
      <UInput
        :model-value="modelValue"
        :type="showPassword ? 'text' : 'password'"
        :placeholder="placeholder"
        :ui="{ trailing: 'pe-1' }"
        class="flex-1"
        @update:model-value="updateValue"
      >
        <template v-if="modelValue" #trailing>
          <UButton
            color="neutral"
            variant="link"
            size="sm"
            :icon="showPassword ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
            :aria-label="showPassword ? 'Hide' : 'Show'"
            :aria-pressed="showPassword"
            @click="showPassword = !showPassword"
          />
        </template>
      </UInput>
      <UButton
        v-if="showValidateButton"
        :loading="validateLoading"
        :disabled="validateDisabled"
        variant="soft"
        @click="emit('validate')"
      >
        {{ validateText }}
      </UButton>
    </div>
    <!-- 提示文字 -->
    <p v-if="hint" class="mt-1 text-xs text-gray-500">{{ hint }}</p>
    <!-- 验证结果 -->
    <div v-if="validationMessage" class="mt-2">
      <div
        v-if="validationResult === 'valid'"
        class="flex items-center gap-1 text-sm text-green-600 dark:text-green-400"
      >
        <UIcon name="i-heroicons-check-circle" class="h-4 w-4" />
        {{ validationMessage }}
      </div>
      <div
        v-else-if="validationResult === 'invalid'"
        class="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400"
      >
        <UIcon name="i-heroicons-exclamation-triangle" class="h-4 w-4" />
        {{ validationMessage }}
      </div>
    </div>
  </div>
</template>
