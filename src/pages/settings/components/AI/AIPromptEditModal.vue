<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PromptPreset, PresetApplicableType } from '@/types/ai'
import {
  getDefaultSystemPrompt,
  getLockedPromptSectionPreview,
  getOriginalBuiltinPreset,
  type LocaleType,
} from '@/config/prompts'
import { usePromptStore } from '@/stores/prompt'

const { t, locale } = useI18n()

const props = defineProps<{
  open: boolean
  mode: 'add' | 'edit'
  preset: PromptPreset | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const promptStore = usePromptStore()

const formData = ref({
  name: '',
  systemPrompt: '',
  supportGroup: true,
  supportPrivate: true,
})

const isBuiltIn = computed(() => props.preset?.isBuiltIn ?? false)
const isEditMode = computed(() => props.mode === 'edit')
const isModified = computed(() => {
  if (!isBuiltIn.value || !props.preset) return false
  return promptStore.isBuiltinPresetModified(props.preset.id)
})

const modalTitle = computed(() => {
  if (isBuiltIn.value) return t('settings.aiPrompt.modal.editBuiltin')
  return isEditMode.value ? t('settings.aiPrompt.modal.editCustom') : t('settings.aiPrompt.modal.addCustom')
})

const canSave = computed(() => {
  return formData.value.name.trim() && formData.value.systemPrompt.trim()
})

function applicableToCheckboxes(applicableTo?: PresetApplicableType): { group: boolean; private: boolean } {
  if (!applicableTo || applicableTo === 'common') {
    return { group: true, private: true }
  }
  return {
    group: applicableTo === 'group',
    private: applicableTo === 'private',
  }
}

function checkboxesToApplicableTo(group: boolean, private_: boolean): PresetApplicableType {
  if (group && private_) return 'common'
  if (group) return 'group'
  if (private_) return 'private'
  return 'common'
}

watch(
  () => props.open,
  (newVal) => {
    if (newVal) {
      if (props.preset) {
        const checkboxes = applicableToCheckboxes(props.preset.applicableTo)
        formData.value = {
          name: props.preset.name,
          systemPrompt: props.preset.systemPrompt,
          supportGroup: checkboxes.group,
          supportPrivate: checkboxes.private,
        }
      } else {
        formData.value = {
          name: '',
          systemPrompt: getDefaultSystemPrompt(locale.value as LocaleType),
          supportGroup: true,
          supportPrivate: true,
        }
      }
    }
  }
)

function closeModal() {
  emit('update:open', false)
}

function handleSave() {
  if (!canSave.value) return

  const applicableTo = checkboxesToApplicableTo(formData.value.supportGroup, formData.value.supportPrivate)

  if (isEditMode.value && props.preset) {
    const updates: {
      name: string
      systemPrompt: string
      applicableTo?: PresetApplicableType
    } = {
      name: formData.value.name.trim(),
      systemPrompt: formData.value.systemPrompt.trim(),
    }
    if (!isBuiltIn.value) {
      updates.applicableTo = applicableTo
    }
    promptStore.updatePromptPreset(props.preset.id, updates)
  } else {
    promptStore.addPromptPreset({
      name: formData.value.name.trim(),
      systemPrompt: formData.value.systemPrompt.trim(),
      applicableTo,
    })
  }

  emit('saved')
  closeModal()
}

function handleReset() {
  if (!props.preset || !isBuiltIn.value) return

  const original = getOriginalBuiltinPreset(props.preset.id, locale.value as LocaleType)
  if (original) {
    formData.value = {
      name: original.name,
      systemPrompt: original.systemPrompt,
      supportGroup: true,
      supportPrivate: true,
    }
    promptStore.resetBuiltinPreset(props.preset.id)
  }
}

const previewContent = computed(() => {
  const lockedSection = getLockedPromptSectionPreview('group', undefined, locale.value as LocaleType)
  return `${formData.value.systemPrompt}

${lockedSection}`
})
</script>

<template>
  <UModal :open="open" :ui="{ content: 'md:w-full max-w-2xl' }" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="p-6">
        <!-- Header -->
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ modalTitle }}</h2>
          <UButton icon="i-heroicons-x-mark" variant="ghost" size="sm" @click="closeModal" />
        </div>

        <!-- 表单 -->
        <div class="max-h-[500px] space-y-4 overflow-y-auto pr-1">
          <!-- 预设名称 -->
          <div>
            <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.aiPrompt.modal.presetName') }}
            </label>
            <UInput
              v-model="formData.name"
              :placeholder="t('settings.aiPrompt.modal.presetNamePlaceholder')"
              class="w-60"
            />
          </div>

          <!-- 适用场景（仅自定义预设显示） -->
          <div v-if="!isBuiltIn">
            <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.aiPrompt.modal.applicableTo') }}
              <span class="font-normal text-gray-500">{{ t('settings.aiPrompt.modal.applicableToHint') }}</span>
            </label>
            <div class="flex items-center gap-4">
              <label class="flex cursor-pointer items-center gap-2">
                <input
                  v-model="formData.supportGroup"
                  type="checkbox"
                  class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span class="text-sm text-gray-700 dark:text-gray-300">
                  {{ t('settings.aiPrompt.modal.groupChat') }}
                </span>
              </label>
              <label class="flex cursor-pointer items-center gap-2">
                <input
                  v-model="formData.supportPrivate"
                  type="checkbox"
                  class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span class="text-sm text-gray-700 dark:text-gray-300">
                  {{ t('settings.aiPrompt.modal.privateChat') }}
                </span>
              </label>
            </div>
          </div>

          <!-- 系统提示词 -->
          <div>
            <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.aiPrompt.modal.systemPrompt') }}
            </label>
            <UTextarea
              v-model="formData.systemPrompt"
              :rows="12"
              :placeholder="t('settings.aiPrompt.modal.systemPromptPlaceholder')"
              class="w-120 font-mono text-sm"
            />
          </div>

          <!-- 完整提示词预览 -->
          <div>
            <label class="mb-1.5 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <UIcon name="i-heroicons-eye" class="h-4 w-4 text-violet-500" />
              {{ t('settings.aiPrompt.modal.preview') }}
              <span class="font-normal text-gray-500">{{ t('settings.aiPrompt.modal.previewHint') }}</span>
            </label>
            <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
              <pre class="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{{ previewContent }}</pre>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="mt-6 flex justify-end gap-2">
          <UButton v-if="isBuiltIn && isModified" variant="outline" color="warning" @click="handleReset">
            <UIcon name="i-heroicons-arrow-path" class="mr-1 h-4 w-4" />
            {{ t('settings.aiPrompt.modal.resetToDefault') }}
          </UButton>
          <UButton variant="ghost" @click="closeModal">{{ t('common.cancel') }}</UButton>
          <UButton color="primary" :disabled="!canSave" @click="handleSave">
            {{ isEditMode ? t('settings.aiPrompt.modal.saveChanges') : t('settings.aiPrompt.modal.addPreset') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
