<script setup lang="ts">
import { computed } from 'vue'
import { useClipboard } from '@vueuse/core'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()
const skillInstallCommand = computed(() => {
  const skillName = locale.value === 'zh-CN' || locale.value === 'zh-TW' ? 'chatlab-import-cn' : 'chatlab-import'
  return `npx skills add ChatLab/ChatLab --skill ${skillName} -g`
})
const cliImportCommand = 'chatlab import ~/Downloads/chat-export.json'
const { copy: copySkillCommand, copied: skillCommandCopied } = useClipboard({ copiedDuring: 2000 })
const { copy: copyCliCommand, copied: cliCommandCopied } = useClipboard({ copiedDuring: 2000 })

const importGuideUrl = computed(() => {
  const prefix = locale.value === 'zh-CN' ? '/cn' : locale.value === 'zh-TW' ? '/tw' : ''
  return `https://docs.chatlab.fun${prefix}/usage/how-to-import`
})
</script>

<template>
  <div class="flex w-full flex-col items-center space-y-6">
    <div class="grid w-full max-w-2xl gap-3 sm:h-[220px] sm:grid-cols-2">
      <section
        class="flex min-h-[210px] flex-col rounded-3xl bg-white/80 p-5 shadow-elevated ring-1 ring-gray-900/[0.04] backdrop-blur-md dark:bg-card-dark dark:ring-white/[0.06]"
      >
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 dark:bg-primary-500/10">
          <UIcon name="i-heroicons-sparkles" class="h-5 w-5 text-primary-600 dark:text-primary-400" />
        </div>
        <div class="mt-3">
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('home.tabs.agentImportTitle') }}</h2>
          <p class="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
            {{ t('home.tabs.agentImportDescription') }}
          </p>
        </div>
        <div
          class="mt-auto flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-gray-700 ring-1 ring-gray-200/80 dark:bg-gray-900 dark:text-gray-100 dark:ring-white/10"
        >
          <code class="min-w-0 flex-1 truncate text-[10px] sm:text-[11px]">{{ skillInstallCommand }}</code>
          <UButton
            :icon="skillCommandCopied ? 'i-heroicons-check' : 'i-heroicons-clipboard'"
            :color="skillCommandCopied ? 'success' : 'neutral'"
            variant="ghost"
            size="xs"
            :aria-label="t('home.tabs.copyCommand')"
            @click="copySkillCommand(skillInstallCommand)"
          />
        </div>
        <UButton
          :href="importGuideUrl"
          target="_blank"
          color="primary"
          variant="link"
          size="xs"
          icon="i-heroicons-document-text"
          class="mt-1 self-start px-0"
        >
          {{ t('home.tabs.viewDocs') }}
        </UButton>
      </section>

      <section
        class="flex min-h-[210px] flex-col rounded-3xl bg-white/80 p-5 shadow-elevated ring-1 ring-gray-900/[0.04] backdrop-blur-md dark:bg-card-dark dark:ring-white/[0.06]"
      >
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 dark:bg-primary-500/10">
          <UIcon name="i-heroicons-command-line" class="h-5 w-5 text-primary-600 dark:text-primary-400" />
        </div>
        <div class="mt-3">
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('home.tabs.manualCliTitle') }}</h2>
          <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {{ t('home.tabs.manualCliDescription') }}
          </p>
        </div>
        <div
          class="mt-auto flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-gray-700 ring-1 ring-gray-200/80 dark:bg-gray-900 dark:text-gray-100 dark:ring-white/10"
        >
          <code class="min-w-0 flex-1 truncate text-[10px] sm:text-[11px]">{{ cliImportCommand }}</code>
          <UButton
            :icon="cliCommandCopied ? 'i-heroicons-check' : 'i-heroicons-clipboard'"
            :color="cliCommandCopied ? 'success' : 'neutral'"
            variant="ghost"
            size="xs"
            :aria-label="t('home.tabs.copyCommand')"
            @click="copyCliCommand(cliImportCommand)"
          />
        </div>
        <UButton
          :href="importGuideUrl"
          target="_blank"
          color="primary"
          variant="link"
          size="xs"
          icon="i-heroicons-document-text"
          class="mt-1 self-start px-0"
        >
          {{ t('home.tabs.viewDocs') }}
        </UButton>
      </section>
    </div>
    <div class="h-6 w-full opacity-0 pointer-events-none" />
  </div>
</template>
