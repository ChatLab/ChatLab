<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import type { SerializedErrorInfo } from '@electron/shared/types'

const { t } = useI18n()
const toast = useToast()

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  error: SerializedErrorInfo
}>()

interface DetailField {
  label: string
  value: string
  isCode?: boolean
  isStack?: boolean
}

const fields = computed<DetailField[]>(() => {
  const e = props.error
  const list: DetailField[] = []

  if (e.url) {
    list.push({ label: t('ai.chat.error.requestUrl'), value: e.url })
  }
  if (e.statusCode != null) {
    list.push({ label: t('ai.chat.error.statusCode'), value: String(e.statusCode) })
  }
  if (e.responseBody) {
    list.push({ label: t('ai.chat.error.responseBody'), value: formatJson(e.responseBody), isCode: true })
  }
  if (e.responseHeaders) {
    list.push({
      label: t('ai.chat.error.responseHeaders'),
      value: JSON.stringify(e.responseHeaders, null, 2),
      isCode: true,
    })
  }
  if (e.name) {
    list.push({ label: t('ai.chat.error.name'), value: e.name })
  }
  if (e.message) {
    list.push({ label: t('ai.chat.error.message'), value: e.message })
  }
  if (e.stack) {
    list.push({ label: t('ai.chat.error.stack'), value: e.stack, isStack: true })
  }
  if (e.cause) {
    list.push({ label: t('ai.chat.error.cause'), value: formatJson(e.cause), isCode: true })
  }
  if (e.provider) {
    list.push({ label: t('ai.chat.error.provider'), value: e.provider })
  }
  if (e.requestBody) {
    list.push({ label: t('ai.chat.error.requestBody'), value: formatJson(e.requestBody), isCode: true })
  }

  return list
})

function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function handleCopyAll() {
  const text = fields.value.map((f) => `${f.label}: ${f.value}`).join('\n\n')
  navigator.clipboard.writeText(text).then(() => {
    toast.success(t('ai.chat.error.copied'))
  })
}
</script>

<template>
  <UModal
    v-model:open="open"
    :ui="{
      content: 'sm:max-w-[700px] z-[100]',
      overlay: 'backdrop-blur-sm z-[99]',
    }"
  >
    <template #content>
      <div class="flex max-h-[80vh] flex-col overflow-hidden">
        <!-- Header -->
        <div class="shrink-0 border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/40">
                <UIcon name="i-heroicons-exclamation-triangle" class="h-4 w-4 text-red-600 dark:text-red-400" />
              </div>
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
                {{ t('ai.chat.error.detail') }}
              </h2>
            </div>
            <UButton icon="i-heroicons-x-mark" variant="ghost" color="neutral" size="sm" @click="open = false" />
          </div>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto px-6 py-4">
          <div class="flex flex-col gap-4">
            <div v-for="(field, idx) in fields" :key="idx" class="flex flex-col gap-1.5">
              <div class="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {{ field.label }}
              </div>

              <!-- Stack trace: red mono -->
              <div
                v-if="field.isStack"
                class="rounded-md border border-red-200 bg-red-50/50 p-3 dark:border-red-900/40 dark:bg-red-950/20"
              >
                <pre
                  class="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-red-600 dark:text-red-400"
                  >{{ field.value }}</pre
                >
              </div>

              <!-- Code block -->
              <div
                v-else-if="field.isCode"
                class="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900"
              >
                <pre
                  class="m-0 max-h-[300px] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-700 dark:text-gray-300"
                  >{{ field.value }}</pre
                >
              </div>

              <!-- Plain text -->
              <div
                v-else
                class="select-text break-words rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              >
                {{ field.value }}
              </div>
            </div>

            <div v-if="fields.length === 0" class="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
              {{ t('ai.chat.error.unknown') }}
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="shrink-0 border-t border-gray-200 px-6 py-3 dark:border-gray-800">
          <div class="flex justify-end">
            <UButton
              icon="i-heroicons-document-duplicate"
              variant="soft"
              color="neutral"
              size="sm"
              @click="handleCopyAll"
            >
              {{ t('ai.chat.error.copyAll') }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
