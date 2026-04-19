<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DataSource } from '@/stores/apiServer'

const props = defineProps<{
  open: boolean
  dataSource: DataSource | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: [updates: { name: string; baseUrl: string; token: string; intervalMinutes: number }]
}>()

const { t } = useI18n()

const form = ref({
  name: '',
  baseUrl: '',
  token: '',
  intervalMinutes: 60,
})

watch(
  () => props.open,
  (val) => {
    if (val && props.dataSource) {
      form.value = {
        name: props.dataSource.name,
        baseUrl: props.dataSource.baseUrl,
        token: props.dataSource.token,
        intervalMinutes: props.dataSource.intervalMinutes,
      }
    }
  }
)

function save() {
  emit('saved', {
    name: form.value.name,
    baseUrl: form.value.baseUrl,
    token: form.value.token,
    intervalMinutes: form.value.intervalMinutes,
  })
  emit('update:open', false)
}
</script>

<template>
  <UModal :open="open" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="p-6" style="min-width: 420px">
        <h3 class="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          {{ t('settings.api.dataSources.edit.title') }}
        </h3>

        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.api.dataSources.form.name') }}
            </label>
            <UInput
              v-model="form.name"
              class="w-full"
              :placeholder="t('settings.api.dataSources.form.namePlaceholder')"
            />
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.api.dataSources.discovery.baseUrl') }}
            </label>
            <UInput v-model="form.baseUrl" class="w-full" placeholder="https://example.com" />
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.api.dataSources.form.token') }}
            </label>
            <UInput
              v-model="form.token"
              class="w-full"
              :placeholder="t('settings.api.dataSources.form.tokenPlaceholder')"
            />
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.api.dataSources.form.interval') }}
            </label>
            <UInput v-model.number="form.intervalMinutes" type="number" :min="1" class="w-full" />
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <UButton variant="soft" @click="emit('update:open', false)">
              {{ t('settings.api.dataSources.edit.cancel') }}
            </UButton>
            <UButton color="primary" @click="save">
              {{ t('settings.api.dataSources.edit.save') }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
