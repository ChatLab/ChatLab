<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { ChatMessage } from '@/composables/useAIChat'
import { useToast } from '@/composables/useToast'
import { useAIService } from '@/services'
import { useCacheService } from '@/services/cache/service'
import { usePromptStore } from '@/stores/prompt'
import {
  exportConversation,
  getExportableConversationMessages,
  hasExportableConversationMessages,
  type ConversationExportSourceMessage,
  type ExportFormat,
} from '@/utils/conversationExport'

const props = defineProps<{
  currentAIChatId?: string | null
  currentMessages?: ChatMessage[]
  fallbackTitle?: string
}>()

const { t } = useI18n()
const toast = useToast()
const promptStore = usePromptStore()
const { aiGlobalSettings } = storeToRefs(promptStore)

const isExporting = ref(false)
const isOpeningLog = ref(false)
const visibleExportMessages = computed(() => getExportableConversationMessages(props.currentMessages ?? []))
const canExportConversation = computed(() => {
  return Boolean(props.currentAIChatId) || hasExportableConversationMessages(props.currentMessages ?? [])
})

function getExportLabels() {
  return {
    createdAt: t('ai.chat.conversation.export.createdAt'),
    user: t('ai.chat.conversation.export.user'),
    assistant: t('ai.chat.conversation.export.assistant'),
  }
}

function toExportSourceMessages(messages: ConversationExportSourceMessage[]): ConversationExportSourceMessage[] {
  return messages.map((message) => ({
    ...message,
    timestamp: message.timestamp * 1000,
  }))
}

async function handleExportConversation() {
  if (isExporting.value || !canExportConversation.value) return

  isExporting.value = true
  try {
    const format = (aiGlobalSettings.value.exportFormat || 'markdown') as ExportFormat
    const labels = getExportLabels()
    let title = props.fallbackTitle || t('ai.chat.conversation.newChat')
    let createdAt = visibleExportMessages.value[0]?.timestamp ?? Date.now()
    let messages = visibleExportMessages.value

    if (props.currentAIChatId) {
      const [conversation, persistedMessages] = await Promise.all([
        useAIService().getAIChat(props.currentAIChatId),
        useAIService().getMessages(props.currentAIChatId),
      ])

      if (conversation) {
        title = conversation.title || title
        createdAt = conversation.createdAt * 1000
      }

      const persistedExportMessages = getExportableConversationMessages(toExportSourceMessages(persistedMessages))
      if (persistedExportMessages.length > 0) {
        messages = persistedExportMessages
      }
    }

    if (messages.length === 0) {
      toast.warn(t('ai.chat.conversation.export.noMessages'))
      return
    }

    const result = await exportConversation(title, messages, createdAt, format, labels)

    if (result.success && result.filePath) {
      const filename = result.filePath.split('/').pop() || result.filePath
      const exportedFilePath = result.filePath
      toast.add({
        title: t('common.exportSuccess'),
        description: filename,
        color: 'primary',
        actions: [
          {
            label: t('common.openFolder'),
            onClick: () => {
              useCacheService().showInFolder(exportedFilePath)
            },
          },
        ],
      })
    } else {
      toast.fail(t('common.exportFailed'), { description: result.error })
    }
  } catch (error) {
    console.error('Failed to export AI conversation:', error)
    toast.fail(t('common.exportFailed'), { description: String(error) })
  } finally {
    isExporting.value = false
  }
}

async function openAiLogFile() {
  if (isOpeningLog.value) return

  isOpeningLog.value = true
  try {
    const result = await useAIService().showAiLogFile()
    if (!result?.success) {
      toast.fail(t('ai.chat.statusBar.log.openFailed'), {
        description: result?.error || t('ai.chat.statusBar.log.openFailedDesc'),
      })
    }
  } catch (error) {
    console.error('Failed to open AI log file:', error)
    toast.fail(t('ai.chat.statusBar.log.openFailed'), { description: String(error) })
  } finally {
    isOpeningLog.value = false
  }
}
</script>

<template>
  <div class="flex shrink-0 items-center gap-1">
    <button
      type="button"
      class="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      :title="t('ai.chat.statusBar.export.title')"
      :disabled="isExporting || !canExportConversation"
      @click="handleExportConversation"
    >
      <UIcon name="i-heroicons-arrow-down-tray" class="h-3.5 w-3.5" />
      <span>{{ t('ai.chat.statusBar.export.label') }}</span>
    </button>

    <button
      type="button"
      class="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      :title="t('ai.chat.statusBar.log.title')"
      :disabled="isOpeningLog"
      @click="openAiLogFile"
    >
      <UIcon name="i-heroicons-document-text" class="h-3.5 w-3.5" />
      <span>{{ t('ai.chat.statusBar.log.label') }}</span>
    </button>
  </div>
</template>
