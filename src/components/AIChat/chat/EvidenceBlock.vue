<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChatEvidencePayload, EvidenceStatus } from '@openchatlab/core'
import { useLayoutStore } from '@/stores/layout'

const props = defineProps<{
  evidence: ChatEvidencePayload
}>()

const { t } = useI18n()
const layoutStore = useLayoutStore()

const expanded = ref(false)

const STATUS_ORDER: EvidenceStatus[] = ['included', 'uncertain', 'excluded']

const sortedGroups = computed(() =>
  [...props.evidence.groups].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
)

const totalSources = computed(() => props.evidence.groups.reduce((sum, group) => sum + group.sources.length, 0))

const statusCounts = computed(() =>
  STATUS_ORDER.map((status) => ({
    status,
    count: props.evidence.groups.filter((group) => group.status === status).length,
  })).filter((item) => item.count > 0)
)

const warnings = computed(() => props.evidence.warnings ?? [])

const statusBadgeClass: Record<EvidenceStatus, string> = {
  included: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400',
  uncertain: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400',
  excluded: 'bg-gray-100 text-gray-500 dark:bg-gray-800/40 dark:text-gray-400',
}

const statusDotClass: Record<EvidenceStatus, string> = {
  included: 'bg-emerald-500',
  uncertain: 'bg-amber-500',
  excluded: 'bg-gray-400',
}

function viewSource(messageId: number): void {
  layoutStore.openChatRecordDrawer({ scrollToMessageId: messageId })
}
</script>

<template>
  <div
    class="my-1.5 w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50/60 text-[13px] dark:border-gray-700/60 dark:bg-gray-800/30"
  >
    <!-- Header (clickable toggle) -->
    <button
      type="button"
      class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-100/60 dark:hover:bg-gray-800/40"
      @click="expanded = !expanded"
    >
      <UIcon name="i-heroicons-document-magnifying-glass" class="h-4 w-4 shrink-0 text-primary-500" />
      <span class="text-xs font-semibold text-gray-700 dark:text-gray-200">{{ t('ai.chat.evidence.title') }}</span>

      <!-- Compact summary (collapsed state) -->
      <div v-if="!expanded" class="flex min-w-0 items-center gap-2">
        <span
          v-for="item in statusCounts"
          :key="item.status"
          class="flex shrink-0 items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400"
        >
          <span class="h-1.5 w-1.5 rounded-full" :class="statusDotClass[item.status]" />
          {{ t(`ai.chat.evidence.group.${item.status}`) }} {{ item.count }}
        </span>
        <span v-if="statusCounts.length === 0" class="truncate text-[11px] text-gray-400 dark:text-gray-500">
          {{ t('ai.chat.evidence.empty') }}
        </span>
      </div>

      <span class="ml-auto flex shrink-0 items-center gap-1.5">
        <span class="text-[11px] text-gray-400 dark:text-gray-500">
          {{ t(`ai.chat.evidence.mode.${evidence.mode}`) }}
        </span>
        <UIcon
          :name="expanded ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'"
          class="h-3.5 w-3.5 text-gray-400 dark:text-gray-500"
        />
      </span>
    </button>

    <!-- Details (expanded state) -->
    <div v-if="expanded" class="border-t border-gray-200/70 px-3 py-2 dark:border-gray-700/50">
      <!-- Query / criteria -->
      <div class="mb-2 space-y-0.5 text-xs text-gray-600 dark:text-gray-400">
        <div>
          <span class="font-medium">{{ t('ai.chat.evidence.query') }}:</span>
          {{ evidence.query }}
        </div>
        <div v-if="evidence.criteria">
          <span class="font-medium">{{ t('ai.chat.evidence.criteria') }}:</span>
          {{ evidence.criteria }}
        </div>
      </div>

      <!-- Warnings -->
      <div v-if="warnings.length > 0" class="mb-2 space-y-1">
        <div
          v-for="warning in warnings"
          :key="warning"
          class="flex items-start gap-1.5 rounded bg-amber-50/70 px-2 py-1 text-[11px] text-amber-600 dark:bg-amber-900/15 dark:text-amber-400"
        >
          <UIcon name="i-heroicons-exclamation-triangle" class="mt-0.5 h-3 w-3 shrink-0" />
          <span>{{ t(`ai.chat.evidence.warning.${warning}`) }}</span>
        </div>
      </div>

      <!-- Empty -->
      <div v-if="sortedGroups.length === 0" class="py-1.5 text-center text-xs text-gray-400 dark:text-gray-500">
        {{ t('ai.chat.evidence.empty') }}
      </div>

      <!-- Groups -->
      <div v-else class="space-y-2">
        <div
          v-for="group in sortedGroups"
          :key="group.id"
          class="rounded-md border border-gray-200/80 bg-white px-2.5 py-1.5 dark:border-gray-700/50 dark:bg-gray-900/30"
        >
          <div class="flex items-center gap-2">
            <span class="rounded px-1.5 py-0.5 text-[11px] font-medium" :class="statusBadgeClass[group.status]">
              {{ t(`ai.chat.evidence.group.${group.status}`) }}
            </span>
            <span class="ml-auto shrink-0 text-[11px] text-gray-400 dark:text-gray-500">{{ group.title }}</span>
          </div>

          <div v-if="group.reason" class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{{ group.reason }}</div>

          <ul class="mt-1 space-y-0.5">
            <li
              v-for="(source, idx) in group.sources"
              :key="`${group.id}-${idx}`"
              class="group/source flex cursor-pointer items-start gap-1.5 rounded px-1.5 py-1 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/40"
              @click="viewSource(source.messageId)"
            >
              <div class="min-w-0 flex-1 text-xs leading-snug text-gray-600 dark:text-gray-300">
                <span v-if="source.senderName" class="mr-1 text-gray-400 dark:text-gray-500">
                  {{ source.senderName }}:
                </span>
                <span class="line-clamp-2 break-words align-middle">{{ source.snippet }}</span>
              </div>
              <UIcon
                name="i-heroicons-arrow-top-right-on-square"
                class="mt-0.5 h-3 w-3 shrink-0 text-gray-400 opacity-0 transition-opacity group-hover/source:opacity-100 dark:text-gray-500"
              />
            </li>
          </ul>
        </div>
      </div>

      <!-- Total sources footnote -->
      <div v-if="sortedGroups.length > 0" class="mt-1.5 text-right text-[11px] text-gray-400 dark:text-gray-500">
        {{ t('ai.chat.evidence.totalSources', { count: totalSources }) }}
      </div>
    </div>
  </div>
</template>
