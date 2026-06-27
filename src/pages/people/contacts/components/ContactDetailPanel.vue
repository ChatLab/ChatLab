<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ContactItem } from '@openchatlab/shared-types'

const props = defineProps<{
  selectedKey: string | null
  contact: ContactItem | null
  isLoading: boolean
  isFriendActionLoading: boolean
}>()

const emit = defineEmits<{
  clear: []
  openSource: [source: ContactItem['sourceSessions'][number]]
  viewSourceRecords: [source: ContactItem['sourceSessions'][number]]
  markFriend: []
  unmarkFriend: []
}>()

const { t } = useI18n()

const visibleAliases = computed(() => {
  const contact = props.contact
  if (!contact) return []
  const hidden = new Set([contact.displayName.trim().toLowerCase(), contact.platformId.trim().toLowerCase()])
  return contact.aliases.filter((alias) => !hidden.has(alias.trim().toLowerCase()))
})

const canMarkFriend = computed(() => props.contact?.pool === 'non_friend')
const canUnmarkFriend = computed(() => props.contact?.friendSource === 'manual')
const showFriendActions = computed(() => canMarkFriend.value || canUnmarkFriend.value)

function avatarText(contact: ContactItem): string {
  return contact.displayName.trim().slice(0, 1).toUpperCase() || '?'
}
</script>

<template>
  <Transition name="contact-detail-panel">
    <aside
      v-if="selectedKey"
      class="flex h-full w-[420px] max-w-[80vw] shrink-0 flex-col border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
      style="-webkit-app-region: no-drag"
    >
      <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <h3 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('contacts.detail.title') }}</h3>
        <UButton
          :aria-label="t('contacts.actions.clearSelection')"
          icon="i-heroicons-x-mark"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="emit('clear')"
        />
      </div>

      <div
        v-if="isLoading"
        class="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-gray-400 dark:text-gray-500"
      >
        <UIcon name="i-lucide-loader-2" class="h-4 w-4 animate-spin" />
        <span>{{ t('common.loading') }}</span>
      </div>

      <div v-else-if="contact" class="min-h-0 flex-1 overflow-y-auto">
        <section class="px-5 py-5">
          <div class="flex items-start gap-4">
            <div class="relative shrink-0">
              <img
                v-if="contact.avatar"
                :src="contact.avatar"
                :alt="contact.displayName"
                loading="lazy"
                decoding="async"
                class="h-16 w-16 rounded-2xl object-cover shadow-sm ring-2 ring-white dark:ring-gray-900"
              />
              <div
                v-else
                class="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-gray-155 to-gray-200 text-lg font-bold text-gray-700 dark:from-gray-800 dark:to-gray-900 dark:text-gray-200"
              >
                {{ avatarText(contact) }}
              </div>
            </div>
            <div class="min-w-0 flex-1 pt-1">
              <h2 class="truncate text-lg font-bold tracking-tight text-gray-900 dark:text-white">
                {{ contact.displayName }}
              </h2>
              <p class="mt-1 truncate font-mono text-xs text-gray-400 dark:text-gray-500">
                {{ contact.platform }} · {{ contact.platformId }}
              </p>
              <div v-if="visibleAliases.length > 0" class="mt-2 flex flex-wrap gap-1.5">
                <span
                  v-for="alias in visibleAliases.slice(0, 4)"
                  :key="alias"
                  class="max-w-full truncate rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-white/5 dark:text-gray-400"
                >
                  {{ alias }}
                </span>
              </div>
              <div v-if="showFriendActions" class="mt-3 flex flex-wrap items-center gap-2">
                <UButton
                  v-if="canMarkFriend"
                  icon="i-lucide-user-plus"
                  color="primary"
                  variant="soft"
                  size="xs"
                  :loading="isFriendActionLoading"
                  @click="emit('markFriend')"
                >
                  {{ t('contacts.actions.markFriend') }}
                </UButton>
                <UButton
                  v-else-if="canUnmarkFriend"
                  icon="i-lucide-user-minus"
                  color="neutral"
                  variant="soft"
                  size="xs"
                  :loading="isFriendActionLoading"
                  @click="emit('unmarkFriend')"
                >
                  {{ t('contacts.actions.unmarkFriend') }}
                </UButton>
              </div>
            </div>
          </div>
        </section>

        <section class="border-t border-gray-100 px-5 py-4 dark:border-white/5">
          <h3 class="mb-3 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {{ t('contacts.detail.sources') }}
          </h3>
          <div class="space-y-2.5">
            <div
              v-for="source in contact.sourceSessions"
              :key="source.id"
              class="w-full rounded-2xl border border-gray-100 bg-white/40 px-3.5 py-3 text-left transition duration-300 hover:border-gray-200 hover:shadow-sm dark:border-white/5 dark:bg-gray-900/10 dark:hover:border-white/10"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {{ source.name }}
                </span>
                <span
                  class="flex items-center gap-1 text-[10px] font-bold text-gray-400 transition group-hover/item:text-pink-500 dark:text-gray-500"
                >
                  {{
                    source.type === 'private'
                      ? t('contacts.detail.sourceType.private')
                      : t('contacts.detail.sourceType.group')
                  }}
                </span>
              </div>
              <div class="mt-1.5 truncate text-[11px] font-medium text-gray-400 dark:text-gray-500">
                {{
                  source.privateMessageCount != null
                    ? t('contacts.metrics.privateMessages', { count: source.privateMessageCount })
                    : t('contacts.metrics.groupSignals', { count: source.coOccurrenceCount ?? 0 })
                }}
              </div>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <UButton
                  icon="i-lucide-arrow-up-right"
                  color="primary"
                  variant="soft"
                  size="xs"
                  @click="emit('openSource', source)"
                >
                  {{ t('contacts.actions.openSourceSession') }}
                </UButton>
                <UButton
                  icon="i-lucide-messages-square"
                  color="primary"
                  variant="soft"
                  size="xs"
                  @click="emit('viewSourceRecords', source)"
                >
                  {{ t('contacts.actions.viewSourceRecords') }}
                </UButton>
              </div>
            </div>
          </div>
        </section>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.contact-detail-panel-enter-active,
.contact-detail-panel-leave-active {
  overflow: hidden;
  transition:
    width 0.22s ease,
    opacity 0.18s ease,
    transform 0.22s ease;
}

.contact-detail-panel-enter-from,
.contact-detail-panel-leave-to {
  width: 0 !important;
  opacity: 0;
  transform: translateX(16px);
}

.contact-detail-panel-enter-to,
.contact-detail-panel-leave-from {
  width: 420px;
  opacity: 1;
  transform: translateX(0);
}
</style>
