<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { ContactItem, ContactsResponse } from '@openchatlab/shared-types'
import { useDataService } from '@/services'
import { useToast } from '@/composables/useToast'
import { useSubTabsScroll } from '@/composables/useSubTabsScroll'
import PageHeader from '@/components/layout/PageHeader.vue'
import { SubTabs } from '@/components/UI'

type ContactPoolTab = 'friend' | 'non_friend'

const { t } = useI18n()
const toast = useToast()
const dataService = useDataService()
const router = useRouter()

const response = ref<ContactsResponse | null>(null)
const isLoading = ref(true)
const isRecomputing = ref(false)
const error = ref('')
const searchQuery = ref('')
const lowSignalExpanded = ref(false)
const selectedKey = ref<string | null>(null)
const pollTimer = ref<ReturnType<typeof setInterval> | null>(null)

const contacts = computed(() => response.value?.contacts ?? [])
const diagnostics = computed(() => response.value?.diagnostics)
const task = computed(() => response.value?.task)
const isTaskRunning = computed(() => task.value?.status === 'running')
const taskFailed = computed(() => task.value?.status === 'failed')

const stats = computed(() => {
  const all = contacts.value
  return {
    total: all.length,
    friends: all.filter((contact) => contact.pool === 'friend').length,
    nonFriends: all.filter((contact) => contact.pool === 'non_friend').length,
    hidden: diagnostics.value?.hiddenLowSignalNonFriends ?? 0,
  }
})

const contactTabs = computed(() => [
  {
    id: 'friend',
    label: `${t('contacts.tabs.friends')} ${stats.value.friends.toLocaleString()}`,
    icon: 'i-heroicons-user',
  },
  {
    id: 'non_friend',
    label: `${t('contacts.tabs.groupContacts')} ${stats.value.nonFriends.toLocaleString()}`,
    icon: 'i-heroicons-user-group',
  },
])

const {
  activeNav: activeContactSection,
  scrollContainerRef,
  setSectionRef,
  handleNavChange: handleContactTabChange,
} = useSubTabsScroll(contactTabs, { scrollBehavior: 'auto', scrollLockDuration: 80 })
void scrollContainerRef

const lowSignalNonFriendCount = computed(
  () => contacts.value.filter((contact) => contact.pool === 'non_friend' && contact.isLowSignal).length
)

const canToggleLowSignal = computed(() => !searchQuery.value.trim() && lowSignalNonFriendCount.value > 0)

function matchesSearch(contact: ContactItem, query: string): boolean {
  if (!query) return true
  return contact.searchText.includes(query)
}

const filteredFriendContacts = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return contacts.value.filter((contact) => contact.pool === 'friend' && matchesSearch(contact, query))
})

const filteredGroupmateContacts = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return contacts.value.filter((contact) => {
    if (contact.pool !== 'non_friend') return false
    if (!lowSignalExpanded.value && !query && contact.isLowSignal) return false
    return matchesSearch(contact, query)
  })
})

const filteredContacts = computed(() => {
  return [...filteredFriendContacts.value, ...filteredGroupmateContacts.value]
})

const contactTableSections = computed(() => [
  {
    id: 'friend' as const,
    contacts: filteredFriendContacts.value,
  },
  {
    id: 'non_friend' as const,
    contacts: filteredGroupmateContacts.value,
  },
])

const selectedContact = computed(() => {
  if (selectedKey.value) {
    const selected = filteredContacts.value.find((contact) => contact.key === selectedKey.value)
    if (selected) return selected
  }
  return null
})

const visibleSelectedContactAliases = computed(() => {
  const contact = selectedContact.value
  if (!contact) return []
  const hidden = new Set([contact.displayName.trim().toLowerCase(), contact.platformId.trim().toLowerCase()])
  return contact.aliases.filter((alias) => !hidden.has(alias.trim().toLowerCase()))
})

watch(filteredContacts, () => {
  if (selectedKey.value && filteredContacts.value.some((contact) => contact.key === selectedKey.value)) return
  selectedKey.value = null
})

watch(
  () => task.value?.status,
  () => syncContactsPolling()
)

onMounted(() => {
  void loadContacts({ acceptStale: true })
})

onUnmounted(() => {
  stopContactsPolling()
})

async function loadContacts(options?: { acceptStale?: boolean; force?: boolean }) {
  isLoading.value = !response.value
  error.value = ''
  try {
    const next = options?.force
      ? await dataService.recomputeContacts()
      : await dataService.getContacts({ acceptStale: options?.acceptStale })
    response.value = next
    if (selectedKey.value && !next.contacts.some((contact) => contact.key === selectedKey.value)) {
      selectedKey.value = null
    }
    syncContactsPolling()
  } catch (err) {
    error.value = String(err)
  } finally {
    isLoading.value = false
  }
}

async function recomputeContacts() {
  isRecomputing.value = true
  try {
    const next = await dataService.recomputeContacts()
    response.value = next
    syncContactsPolling()
    toast.success(t('contacts.toast.recomputeStarted'))
  } catch (err) {
    toast.fail(t('contacts.toast.recomputeFailed'), { description: String(err) })
  } finally {
    isRecomputing.value = false
  }
}

function syncContactsPolling() {
  if (isTaskRunning.value) {
    startContactsPolling()
  } else {
    stopContactsPolling()
  }
}

function startContactsPolling() {
  if (pollTimer.value) return
  pollTimer.value = setInterval(() => {
    void loadContacts({ acceptStale: true })
  }, 1500)
}

function stopContactsPolling() {
  if (!pollTimer.value) return
  clearInterval(pollTimer.value)
  pollTimer.value = null
}

function selectContact(contact: ContactItem) {
  selectedKey.value = contact.key
}

function contactBadgeLabel(contact: ContactItem): string {
  if (contact.pool === 'friend') return t('contacts.pool.friend')
  if (contact.isLowSignal) return t('contacts.badge.lowSignal')
  return t('contacts.pool.nonFriend')
}

function contactBadgeClasses(contact: ContactItem): string {
  if (contact.pool === 'friend') {
    return 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400 border border-sky-100/50 dark:border-sky-500/20'
  }
  if (contact.isLowSignal) {
    return 'bg-gray-50 text-gray-500 dark:bg-gray-500/10 dark:text-gray-400 border border-gray-100/50 dark:border-gray-500/20'
  }
  return 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 border border-emerald-100/50 dark:border-emerald-500/20'
}

function contactGridClass(pool: ContactPoolTab): string {
  return pool === 'friend' ? 'contact-table-grid--friends' : 'contact-table-grid--group-contacts'
}

function contactFirstMetric(pool: ContactPoolTab, contact: ContactItem): string {
  return pool === 'friend'
    ? formatCount(contact.scoreBreakdown.privateMessageCount)
    : formatCount(contact.scoreBreakdown.commonGroupCount)
}

function contactSecondMetric(pool: ContactPoolTab, contact: ContactItem): string {
  return pool === 'friend'
    ? formatCount(contact.scoreBreakdown.activePrivateMonths)
    : formatCount(contact.scoreBreakdown.coOccurrenceCount)
}

function contactThirdMetric(pool: ContactPoolTab, contact: ContactItem): string {
  return pool === 'friend'
    ? formatCount(contact.scoreBreakdown.commonGroupCount)
    : formatCount(contact.scoreBreakdown.replyInteractionCount)
}

function avatarText(contact: ContactItem): string {
  return (contact.displayName || contact.platformId || '?').slice(0, 1)
}

function formatScore(score: number): string {
  return Math.round(score * 100).toString()
}

function formatCount(value: number | undefined): string {
  return String(value ?? 0)
}

function formatTime(ts: number | null | undefined): string {
  if (!ts) return t('contacts.emptyValue')
  return new Date(ts * 1000).toLocaleDateString()
}

function openSourceSession(source: ContactItem['sourceSessions'][number]) {
  router.push({
    name: source.type === 'private' ? 'private-chat' : 'group-chat',
    params: { id: source.id },
  })
}

const headerRefs = ref<Record<ContactPoolTab, HTMLDivElement | null>>({
  friend: null,
  non_friend: null,
})

function setHeaderRef(pool: ContactPoolTab, el: HTMLElement | null) {
  headerRefs.value[pool] = el as HTMLDivElement | null
}

function syncScroll(pool: ContactPoolTab, e: Event) {
  const target = e.target as HTMLDivElement
  const header = headerRefs.value[pool]
  if (header) {
    header.scrollLeft = target.scrollLeft
  }
}
</script>

<template>
  <div
    class="flex h-full flex-col bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100"
    style="padding-top: var(--titlebar-area-height)"
  >
    <PageHeader
      :title="t('contacts.title')"
      :description="t('contacts.subtitle', { count: diagnostics?.privateSessionCount ?? 0 })"
      size="compact"
      icon="i-lucide-users"
      icon-class="bg-primary-600 text-white dark:bg-primary-500 dark:text-white shadow-sm"
    >
      <template #actions>
        <UButton
          icon="i-lucide-refresh-cw"
          color="primary"
          variant="soft"
          size="sm"
          class="rounded-xl border border-pink-100 hover:border-pink-200 dark:border-pink-950/30 dark:hover:border-pink-900/50"
          :loading="isRecomputing"
          :disabled="isTaskRunning"
          @click="recomputeContacts"
        >
          {{ t('contacts.actions.recompute') }}
        </UButton>
      </template>

      <div class="mt-3 flex items-center justify-between gap-3 pb-1.5">
        <div class="flex shrink-0 items-center gap-0.5 overflow-x-auto scrollbar-hide">
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-lg bg-pink-500 px-2.5 py-1.5 text-xs font-semibold text-white transition-all dark:bg-pink-900/30 dark:text-pink-300"
          >
            <UIcon name="i-heroicons-chart-pie" class="h-3.5 w-3.5" />
            <span class="whitespace-nowrap">{{ t('analysis.tabs.overview') }}</span>
          </button>
        </div>

        <!-- 统计指标面板 -->
        <div class="hidden items-center gap-5 text-[11px] sm:flex">
          <div class="flex items-center gap-1.5">
            <span class="text-gray-400 dark:text-gray-500">{{ t('contacts.stats.total') }}</span>
            <span class="font-mono font-bold text-gray-900 dark:text-white">{{ stats.total }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="text-gray-400 dark:text-gray-500">{{ t('contacts.stats.friends') }}</span>
            <span class="font-mono font-bold text-gray-900 dark:text-white">{{ stats.friends }}</span>
          </div>
          <div class="h-3 w-px bg-gray-250 dark:bg-white/10"></div>
          <div class="flex items-center gap-1.5">
            <span class="text-gray-400 dark:text-gray-500">{{ t('contacts.stats.nonFriends') }}</span>
            <span class="font-mono font-bold text-gray-900 dark:text-white">{{ stats.nonFriends }}</span>
          </div>
        </div>
      </div>
    </PageHeader>

    <div class="flex min-h-0 flex-1 flex-col">
      <SubTabs
        v-model="activeContactSection"
        :items="contactTabs"
        persist-key="contactsTab"
        @change="handleContactTabChange"
      >
        <template #right>
          <div class="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 px-3 py-2 lg:px-0 lg:py-0">
            <UInput
              v-model="searchQuery"
              icon="i-lucide-search"
              :placeholder="t('contacts.search')"
              size="sm"
              class="w-full sm:w-64"
            />
          </div>
        </template>
      </SubTabs>

      <div class="flex min-h-0 flex-1 overflow-hidden">
        <main ref="scrollContainerRef" class="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div class="mx-auto flex w-full max-w-[1800px] flex-col gap-6 px-6 pb-6 pt-0 lg:px-8">
            <div
              v-if="diagnostics && !diagnostics.contactsEnabled"
              class="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/50 px-4 py-3.5 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200"
            >
              <UIcon name="i-lucide-alert-triangle" class="h-5 w-5 shrink-0 text-amber-500" />
              <span>{{ t('contacts.disabled', { count: diagnostics.privateSessionCount }) }}</span>
            </div>

            <div
              v-if="response?.cache.status === 'stale'"
              class="flex flex-col gap-3 rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3.5 text-sm text-sky-800 dark:border-sky-900/30 dark:bg-sky-950/20 dark:text-sky-200 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="flex items-center gap-3">
                <UIcon name="i-lucide-info" class="h-5 w-5 shrink-0 text-sky-500" />
                <span>{{ isTaskRunning ? t('contacts.task.updating') : t('contacts.stale.inline') }}</span>
              </div>
              <UButton
                size="xs"
                color="primary"
                variant="solid"
                class="rounded-xl"
                :loading="isRecomputing || isTaskRunning"
                :disabled="isTaskRunning"
                @click="recomputeContacts"
              >
                {{ t('contacts.actions.recompute') }}
              </UButton>
            </div>

            <div
              v-if="response?.cache.status === 'missing' && isTaskRunning"
              class="flex items-center gap-3 rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3.5 text-sm text-sky-800 dark:border-sky-900/30 dark:bg-sky-950/20 dark:text-sky-200"
            >
              <UIcon name="i-lucide-loader-2" class="h-5 w-5 shrink-0 animate-spin text-sky-500" />
              <span>
                {{
                  t('contacts.task.running', {
                    current: task?.processedSessions ?? 0,
                    total: task?.totalSessions ?? 0,
                  })
                }}
              </span>
            </div>

            <div
              v-if="taskFailed"
              class="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50/50 px-4 py-3.5 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="flex min-w-0 items-center gap-3">
                <UIcon name="i-lucide-alert-circle" class="h-5 w-5 shrink-0 text-red-500" />
                <span class="truncate">{{ task?.lastError || t('contacts.task.failed') }}</span>
              </div>
              <UButton size="xs" color="error" variant="soft" class="rounded-xl" @click="recomputeContacts">
                {{ t('contacts.task.retry') }}
              </UButton>
            </div>

            <section class="flex flex-col gap-4">
              <!-- 加载骨架 -->
              <div v-if="isLoading" class="space-y-8">
                <div v-for="g in 3" :key="g" class="space-y-4">
                  <!-- 分组骨架标题 -->
                  <div class="flex items-center gap-3">
                    <div class="h-5 w-20 animate-pulse rounded-lg bg-gray-100 dark:bg-white/5" />
                    <div class="h-4 w-10 animate-pulse rounded-lg bg-gray-50 dark:bg-white/5" />
                    <div class="h-px flex-1 bg-gray-100 dark:bg-white/5" />
                  </div>
                  <!-- 列表骨架 -->
                  <div class="space-y-2">
                    <div
                      v-for="i in 4"
                      :key="i"
                      class="h-[76px] animate-pulse rounded-2xl bg-gray-100 dark:bg-white/5"
                    />
                  </div>
                </div>
              </div>

              <div
                v-else-if="error"
                class="rounded-2xl border border-red-200 bg-red-50/50 p-4 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-300"
              >
                {{ error }}
              </div>

              <!-- 主体列表 -->
              <div v-else class="min-h-0">
                <section class="min-w-0 space-y-8">
                  <!-- 空状态 -->
                  <div
                    v-if="filteredContacts.length === 0"
                    class="flex flex-col items-center justify-center rounded-3xl border border-dashed border-gray-250 p-16 text-center dark:border-white/5"
                  >
                    <div
                      class="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-50 text-gray-400 dark:bg-white/5 dark:text-gray-500"
                    >
                      <UIcon name="i-lucide-users-2" class="h-6 w-6" />
                    </div>
                    <p class="mt-4 text-sm font-medium text-gray-400 dark:text-gray-500">{{ t('contacts.empty') }}</p>
                  </div>

                  <section
                    v-for="section in contactTableSections"
                    :key="section.id"
                    :ref="(el) => setSectionRef(section.id, el as HTMLElement)"
                    class="scroll-mt-0 space-y-0"
                  >
                    <!-- 表头外层包裹，负责水平滚动同步和 y 轴吸顶 -->
                    <div
                      :ref="(el) => setHeaderRef(section.id, el as HTMLElement)"
                      class="sticky top-0 z-10 overflow-x-hidden border-b border-gray-100 bg-white dark:border-gray-800/40 dark:bg-gray-900"
                    >
                      <!-- 真实的表头，保持 min-w-720px 与表体一致 -->
                      <div
                        class="contact-table-grid px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500"
                        :class="contactGridClass(section.id)"
                        style="min-width: 720px"
                      >
                        <span>{{ t('contacts.table.contact') }}</span>
                        <span>{{ t('contacts.table.status') }}</span>
                        <template v-if="section.id === 'friend'">
                          <span>{{ t('contacts.metrics.privateMessagesLabel') }}</span>
                          <span>{{ t('contacts.metrics.activeMonths') }}</span>
                          <span>{{ t('contacts.metrics.commonGroups') }}</span>
                        </template>
                        <template v-else>
                          <span>{{ t('contacts.metrics.commonGroups') }}</span>
                          <span>{{ t('contacts.metrics.coOccurrence') }}</span>
                          <span>{{ t('contacts.metrics.replies') }}</span>
                        </template>
                        <span>{{ t('contacts.metrics.lastInteractionShort') }}</span>
                        <span class="text-right">{{ t('contacts.detail.score') }}</span>
                      </div>
                    </div>

                    <!-- 表体，负责水平溢出滚动 -->
                    <div class="overflow-x-auto scrollbar-hide" @scroll="syncScroll(section.id, $event)">
                      <div class="min-w-[720px]">
                        <button
                          v-for="contact in section.contacts"
                          :key="contact.key"
                          type="button"
                          class="contact-table-grid relative w-full px-4 py-3.5 text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                          :class="[
                            contactGridClass(section.id),
                            selectedContact?.key === contact.key
                              ? 'border-b border-primary-500/20 bg-primary-500/[0.03] dark:bg-primary-500/[0.04]'
                              : 'border-b border-gray-100/50 bg-transparent hover:bg-gray-50/50 dark:border-white/5 dark:hover:bg-gray-800/20',
                          ]"
                          :aria-label="t('contacts.actions.viewDetail', { name: contact.displayName })"
                          @click="selectContact(contact)"
                        >
                          <!-- 选中激活细杠 -->
                          <div
                            class="absolute left-0 top-1/4 h-1/2 w-1 rounded-r-full bg-primary-500 transition-all duration-300"
                            :class="
                              selectedContact?.key === contact.key ? 'scale-100 opacity-100' : 'scale-75 opacity-0'
                            "
                          ></div>

                          <div class="group flex min-w-0 w-full items-center gap-3">
                            <div class="relative shrink-0 overflow-hidden rounded-lg">
                              <img
                                v-if="contact.avatar"
                                :src="contact.avatar"
                                :alt="contact.displayName"
                                class="h-10 w-10 object-cover transition-transform duration-300 group-hover:scale-105"
                              />
                              <div
                                v-else
                                class="flex h-10 w-10 items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 text-sm font-bold text-gray-500 transition-transform duration-300 group-hover:scale-105 dark:from-gray-800 dark:to-gray-800/60 dark:text-gray-400"
                              >
                                {{ avatarText(contact) }}
                              </div>
                            </div>

                            <div class="min-w-0 flex-1">
                              <div class="flex min-w-0 items-center gap-1">
                                <span
                                  class="truncate text-sm font-semibold leading-tight tracking-tight text-gray-800 transition-colors group-hover:text-primary-600 group-focus-visible:text-primary-600 dark:text-gray-200 dark:group-hover:text-primary-400 dark:group-focus-visible:text-primary-400"
                                  :class="
                                    selectedContact?.key === contact.key ? 'text-primary-600 dark:text-primary-400' : ''
                                  "
                                >
                                  {{ contact.displayName }}
                                </span>
                              </div>
                              <span
                                class="mt-1 inline-flex items-center rounded bg-gray-50 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-gray-400 dark:bg-white/5 dark:text-gray-500"
                              >
                                {{ contact.platform }}
                              </span>
                            </div>
                          </div>

                          <span
                            class="inline-flex w-fit justify-self-start rounded-lg px-2.5 py-1 text-xs font-semibold"
                            :class="contactBadgeClasses(contact)"
                          >
                            {{ contactBadgeLabel(contact) }}
                          </span>

                          <span class="contact-table-value">{{ contactFirstMetric(section.id, contact) }}</span>
                          <span class="contact-table-value">{{ contactSecondMetric(section.id, contact) }}</span>
                          <span class="contact-table-value">{{ contactThirdMetric(section.id, contact) }}</span>
                          <span class="contact-table-value">
                            {{ formatTime(contact.lastInteractionTs) }}
                          </span>
                          <span
                            class="inline-flex h-7 w-12 items-center justify-center justify-self-end rounded-lg font-mono text-xs font-bold tabular-nums transition-colors duration-200"
                            :class="
                              selectedContact?.key === contact.key
                                ? 'bg-primary-500 text-white'
                                : 'bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400'
                            "
                          >
                            {{ formatScore(contact.score) }}
                          </span>
                        </button>

                        <button
                          v-if="section.id === 'non_friend' && canToggleLowSignal"
                          type="button"
                          class="flex h-11 w-full items-center justify-center gap-2 border-b border-gray-100/50 bg-transparent text-xs font-semibold text-gray-500 transition hover:bg-gray-50/50 dark:border-white/5 dark:text-gray-400 dark:hover:bg-gray-800/20"
                          @click="lowSignalExpanded = !lowSignalExpanded"
                        >
                          <UIcon
                            :name="lowSignalExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                            class="h-4 w-4"
                          />
                          <span>
                            {{
                              lowSignalExpanded
                                ? t('contacts.actions.hideLowSignal')
                                : t('contacts.actions.showMoreLowSignal', { count: lowSignalNonFriendCount })
                            }}
                          </span>
                        </button>
                      </div>
                    </div>
                  </section>
                </section>
              </div>
            </section>
          </div>
        </main>

        <Transition name="contact-detail-panel">
          <aside
            v-if="selectedContact"
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
                @click="selectedKey = null"
              />
            </div>

            <div v-if="selectedContact" class="min-h-0 flex-1 overflow-y-auto">
              <section class="px-5 py-5">
                <div class="flex items-start gap-4">
                  <div class="relative shrink-0">
                    <img
                      v-if="selectedContact.avatar"
                      :src="selectedContact.avatar"
                      :alt="selectedContact.displayName"
                      class="h-16 w-16 rounded-2xl object-cover shadow-sm ring-2 ring-white dark:ring-gray-900"
                    />
                    <div
                      v-else
                      class="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-gray-155 to-gray-200 text-lg font-bold text-gray-700 dark:from-gray-800 dark:to-gray-900 dark:text-gray-200"
                    >
                      {{ avatarText(selectedContact) }}
                    </div>
                  </div>
                  <div class="min-w-0 flex-1 pt-1">
                    <h2 class="truncate text-lg font-bold tracking-tight text-gray-900 dark:text-white">
                      {{ selectedContact.displayName }}
                    </h2>
                    <p class="mt-1 truncate font-mono text-xs text-gray-400 dark:text-gray-500">
                      {{ selectedContact.platform }} · {{ selectedContact.platformId }}
                    </p>
                    <div v-if="visibleSelectedContactAliases.length > 0" class="mt-2 flex flex-wrap gap-1.5">
                      <span
                        v-for="alias in visibleSelectedContactAliases.slice(0, 4)"
                        :key="alias"
                        class="max-w-full truncate rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-white/5 dark:text-gray-400"
                      >
                        {{ alias }}
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              <section class="border-t border-gray-100 px-5 py-4 dark:border-white/5">
                <h3 class="mb-3 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  {{ t('contacts.detail.sources') }}
                </h3>
                <div class="space-y-2.5">
                  <button
                    v-for="source in selectedContact.sourceSessions"
                    :key="source.id"
                    type="button"
                    class="group/item w-full rounded-2xl border border-gray-100 bg-white/40 px-3.5 py-3 text-left transition duration-300 hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-sm dark:border-white/5 dark:bg-gray-900/10 dark:hover:border-white/10"
                    @click="openSourceSession(source)"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span class="truncate text-xs font-semibold text-gray-700 dark:text-gray-300">
                        {{ source.name }}
                      </span>
                      <span
                        class="flex items-center gap-1 text-[10px] font-bold text-gray-400 transition group-hover/item:text-pink-500 dark:text-gray-500"
                      >
                        {{ source.type === 'private' ? '私聊' : '群聊' }}
                        <UIcon
                          name="i-lucide-arrow-up-right"
                          class="h-3 w-3 transition-transform group-hover/item:translate-x-0.5 group-hover/item:-translate-y-0.5"
                        />
                      </span>
                    </div>
                    <div class="mt-1.5 truncate text-[11px] font-medium text-gray-400 dark:text-gray-500">
                      {{
                        source.privateMessageCount != null
                          ? t('contacts.metrics.privateMessages', { count: source.privateMessageCount })
                          : t('contacts.metrics.groupSignals', { count: source.coOccurrenceCount ?? 0 })
                      }}
                    </div>
                  </button>
                </div>
              </section>
            </div>
          </aside>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.contact-table-grid {
  display: grid;
  align-items: center;
  column-gap: 12px;
  min-width: 0;
}

.contact-table-grid--friends,
.contact-table-grid--group-contacts {
  grid-template-columns: minmax(180px, 1.5fr) 88px 86px 86px 86px 104px 54px;
}

.contact-table-grid > * {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-table-value {
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgb(75, 85, 99);
}

.dark .contact-table-value {
  color: rgb(209, 213, 219);
}

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
