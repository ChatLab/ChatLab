<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  added: [
    data: {
      name: string
      url: string
      token: string
      intervalMinutes: number
      enabled: boolean
      targetSessionId: string
    },
  ]
}>()

const { t } = useI18n()

const formData = ref({
  name: '',
  url: '',
  token: '',
  intervalMinutes: 60,
  enabled: true,
  targetSessionId: '',
})

watch(
  () => props.open,
  (val) => {
    if (val) {
      formData.value = { name: '', url: '', token: '', intervalMinutes: 60, enabled: true, targetSessionId: '' }
    }
  }
)

function closeModal() {
  emit('update:open', false)
}

function handleAdd() {
  if (!formData.value.name || !formData.value.url) return
  emit('added', { ...formData.value })
  closeModal()
}
</script>

<template>
  <UModal :open="open" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="p-6">
        <h3 class="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          {{ t('settings.api.dataSources.form.modalTitle') }}
        </h3>

        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.api.dataSources.form.name') }}
            </label>
            <UInput
              v-model="formData.name"
              class="w-full"
              :placeholder="t('settings.api.dataSources.form.namePlaceholder')"
            />
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.api.dataSources.form.url') }}
            </label>
            <UInput v-model="formData.url" class="w-full" placeholder="https://example.com/api/export" />
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.api.dataSources.form.token') }}
            </label>
            <UInput
              v-model="formData.token"
              class="w-full"
              :placeholder="t('settings.api.dataSources.form.tokenPlaceholder')"
            />
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.api.dataSources.form.interval') }}
            </label>
            <UInput v-model.number="formData.intervalMinutes" type="number" :min="1" class="w-full" />
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.api.dataSources.form.targetSession') }}
            </label>
            <UInput
              v-model="formData.targetSessionId"
              class="w-full"
              :placeholder="t('settings.api.dataSources.form.targetSessionPlaceholder')"
            />
          </div>
        </div>

        <div class="mt-6 flex justify-end gap-2">
          <UButton variant="soft" @click="closeModal">{{ t('common.cancel') }}</UButton>
          <UButton color="primary" :disabled="!formData.name || !formData.url" @click="handleAdd">
            {{ t('common.add') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
