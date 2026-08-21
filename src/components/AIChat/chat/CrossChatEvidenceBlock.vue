<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CrossChatEvidencePayload, CrossChatEvidenceSource } from '@openchatlab/shared-types'
import { useLayoutStore } from '@/stores/layout'
import ProcessDisclosure from './ProcessDisclosure.vue'
import ProcessDisclosureIcon from './ProcessDisclosureIcon.vue'

const props = defineProps<{
  evidence: CrossChatEvidencePayload
}>()

const { t } = useI18n()
const layoutStore = useLayoutStore()

const sessionGroups = computed(() => {
  const groups = new Map<string, { sessionName: string; sessionType: string; sources: CrossChatEvidenceSource[] }>()
  for (const source of props.evidence.sources) {
    const existing = groups.get(source.sessionId)
    if (existing) {
      existing.sources.push(source)
    } else {
      groups.set(source.sessionId, {
        sessionName: source.sessionName,
        sessionType: source.sessionType,
        sources: [source],
      })
    }
  }
  return [...groups.entries()].map(([sessionId, group]) => ({ sessionId, ...group }))
})

function viewSource(source: CrossChatEvidenceSource): void {
  layoutStore.openChatRecordDrawer({
    sessionId: source.sessionId,
    scrollToMessageId: source.messageId,
  })
}
</script>

<template>
  <ProcessDisclosure lazy class="w-full text-[13px]">
    <template #summary="{ open, toggle }">
      <button
        type="button"
        class="group/process-toggle flex h-7 w-full items-center gap-2 rounded-md text-left text-sm leading-7 text-gray-500 transition-colors hover:bg-gray-50/80 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/30 dark:hover:text-gray-300"
        :aria-expanded="open"
        @click="toggle"
      >
        <ProcessDisclosureIcon icon="i-heroicons-document-magnifying-glass" :open="open" />
        <span class="shrink-0 text-gray-600 dark:text-gray-300">{{ t('ai.chat.crossChatEvidence.title') }}</span>
        <span class="ml-auto shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
          {{
            t('ai.chat.crossChatEvidence.summary', {
              sources: evidence.sources.length,
              sessions: sessionGroups.length,
            })
          }}
        </span>
      </button>
    </template>

    <div
      class="cross-chat-evidence-details mx-px mt-1 rounded-lg border border-gray-200/60 bg-gray-50/80 px-3 py-2 dark:border-white/5 dark:bg-white/[0.03]"
    >
      <div class="mb-2 flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span class="min-w-0 flex-1">
          <span class="text-gray-600 dark:text-gray-300">{{ t('ai.chat.crossChatEvidence.query') }}:</span>
          {{ evidence.query }}
        </span>
        <span
          v-if="evidence.coverage.truncated"
          class="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-600 dark:bg-amber-900/20 dark:text-amber-400"
        >
          {{ t('ai.chat.crossChatEvidence.partial') }}
        </span>
      </div>

      <div v-if="sessionGroups.length === 0" class="py-2 text-center text-xs text-gray-400 dark:text-gray-500">
        {{ t('ai.chat.crossChatEvidence.empty') }}
      </div>

      <div v-else class="space-y-2">
        <section
          v-for="group in sessionGroups"
          :key="group.sessionId"
          class="rounded-md border border-gray-200/80 bg-white px-2.5 py-2 dark:border-gray-700/50 dark:bg-page-dark/30"
        >
          <div class="mb-1 flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
            <UIcon
              :name="group.sessionType === 'group' ? 'i-heroicons-user-group' : 'i-heroicons-user'"
              class="h-3.5 w-3.5 shrink-0 text-gray-400"
            />
            <span class="min-w-0 flex-1 truncate">{{ group.sessionName }}</span>
            <span class="shrink-0 text-[11px] text-gray-400">
              {{ t('ai.chat.crossChatEvidence.sourceCount', { count: group.sources.length }) }}
            </span>
          </div>

          <button
            v-for="source in group.sources"
            :key="`${source.sessionId}:${source.messageId}`"
            type="button"
            class="group/source flex w-full items-start gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/40"
            @click="viewSource(source)"
          >
            <div class="min-w-0 flex-1 text-xs leading-snug text-gray-600 dark:text-gray-300">
              <span class="mr-1 text-gray-400 dark:text-gray-500">{{ source.senderName }}:</span>
              <span class="line-clamp-2 break-words">{{ source.snippet }}</span>
            </div>
            <UIcon
              name="i-heroicons-arrow-top-right-on-square"
              class="mt-0.5 h-3 w-3 shrink-0 text-gray-400 opacity-0 transition-opacity group-hover/source:opacity-100"
            />
          </button>
        </section>
      </div>

      <p class="mt-2 text-right text-[11px] text-gray-400 dark:text-gray-500">
        {{
          t('ai.chat.crossChatEvidence.coverage', {
            scanned: evidence.coverage.scannedSessions,
            candidates: evidence.coverage.candidateSessions,
          })
        }}
      </p>
    </div>
  </ProcessDisclosure>
</template>

<style scoped>
.cross-chat-evidence-details {
  max-height: min(32rem, 65vh);
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
</style>
