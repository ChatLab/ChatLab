<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { ContactItem, ContactTier, ContactsResponse } from '@openchatlab/shared-types'
import { useDataService } from '@/services'
import { useToast } from '@/composables/useToast'
import PageHeader from '@/components/layout/PageHeader.vue'

type PoolFilter = 'all' | 'friend' | 'non_friend'
type TierFilter = 'all' | ContactTier

const { t } = useI18n()
const toast = useToast()
const dataService = useDataService()
const router = useRouter()

const response = ref<ContactsResponse | null>(null)
const isLoading = ref(true)
const isRecomputing = ref(false)
const error = ref('')
const searchQuery = ref('')
const poolFilter = ref<PoolFilter>('all')
const tierFilter = ref<TierFilter>('all')
const showLowInteraction = ref(false)
const selectedKey = ref<string | null>(null)
const pendingOverrideKey = ref<string | null>(null)
const showRecomputePrompt = ref(false)

const tierOrder: ContactTier[] = [
  'core',
  'friend',
  'acquaintance',
  'high_interaction',
  'medium_interaction',
  'low_interaction',
]

const contacts = computed(() => response.value?.contacts ?? [])
const diagnostics = computed(() => response.value?.diagnostics)

const stats = computed(() => {
  const all = contacts.value
  return {
    total: all.length,
    friends: all.filter((contact) => contact.pool === 'friend').length,
    core: all.filter((contact) => contact.tier === 'core').length,
    nonFriends: all.filter((contact) => contact.pool === 'non_friend').length,
    hidden: diagnostics.value?.hiddenLowInteractionNonFriends ?? 0,
  }
})

const filteredContacts = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return contacts.value.filter((contact) => {
    if (poolFilter.value !== 'all' && contact.pool !== poolFilter.value) return false
    if (tierFilter.value !== 'all' && contact.tier !== tierFilter.value) return false
    if (!showLowInteraction.value && !query && contact.pool === 'non_friend' && contact.tier === 'low_interaction') {
      return false
    }
    if (!query) return true
    return contact.searchText.includes(query)
  })
})

const groupedContacts = computed(() => {
  const groups = new Map<ContactTier, ContactItem[]>()
  for (const contact of filteredContacts.value) {
    const group = groups.get(contact.tier) ?? []
    group.push(contact)
    groups.set(contact.tier, group)
  }
  return tierOrder
    .map((tier) => ({ tier, contacts: groups.get(tier) ?? [] }))
    .filter((group) => group.contacts.length > 0)
})

const selectedContact = computed(() => {
  if (selectedKey.value) {
    const selected = filteredContacts.value.find((contact) => contact.key === selectedKey.value)
    if (selected) return selected
  }
  return filteredContacts.value[0] ?? null
})

watch(filteredContacts, () => {
  if (selectedKey.value && filteredContacts.value.some((contact) => contact.key === selectedKey.value)) return
  selectedKey.value = filteredContacts.value[0]?.key ?? null
})

onMounted(() => {
  void loadContacts({ acceptStale: true })
})

async function loadContacts(options?: { acceptStale?: boolean; force?: boolean }) {
  isLoading.value = !response.value
  error.value = ''
  try {
    const next = options?.force
      ? await dataService.recomputeContacts()
      : await dataService.getContacts({ acceptStale: options?.acceptStale })
    response.value = next
    selectedKey.value = selectedKey.value ?? next.contacts[0]?.key ?? null
    showRecomputePrompt.value = next.cache.status === 'stale'
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
    showRecomputePrompt.value = false
    toast.success(t('contacts.toast.recomputed'))
  } catch (err) {
    toast.fail(t('contacts.toast.recomputeFailed'), { description: String(err) })
  } finally {
    isRecomputing.value = false
  }
}

async function lockAsCore(contact: ContactItem) {
  pendingOverrideKey.value = contact.key
  try {
    response.value = await dataService.setContactOverride(contact.key, { lockedTier: 'core' })
    selectedKey.value = contact.key
  } catch (err) {
    toast.fail(t('contacts.toast.overrideFailed'), { description: String(err) })
  } finally {
    pendingOverrideKey.value = null
  }
}

async function unlockTier(contact: ContactItem) {
  pendingOverrideKey.value = contact.key
  try {
    response.value = await dataService.deleteContactOverride(contact.key)
    selectedKey.value = contact.key
  } catch (err) {
    toast.fail(t('contacts.toast.overrideFailed'), { description: String(err) })
  } finally {
    pendingOverrideKey.value = null
  }
}

function selectContact(contact: ContactItem) {
  selectedKey.value = contact.key
}

function tierLabel(tier: ContactTier): string {
  return t(`contacts.tier.${tier}`)
}

function tierClasses(tier: ContactTier): string {
  const classes: Record<ContactTier, string> = {
    core: 'bg-pink-50 text-pink-600 dark:bg-pink-500/10 dark:text-pink-400 border border-pink-100/50 dark:border-pink-500/20',
    friend:
      'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400 border border-sky-100/50 dark:border-sky-500/20',
    acquaintance:
      'bg-slate-50 text-slate-600 dark:bg-slate-500/10 dark:text-slate-400 border border-slate-100/50 dark:border-slate-500/20',
    high_interaction:
      'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 border border-emerald-100/50 dark:border-emerald-500/20',
    medium_interaction:
      'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 border border-amber-100/50 dark:border-amber-500/20',
    low_interaction:
      'bg-gray-50 text-gray-500 dark:bg-gray-500/10 dark:text-gray-400 border border-gray-100/50 dark:border-gray-500/20',
  }
  return classes[tier]
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

const activeTab = ref('overview')
const tabs = [
  { id: 'overview', labelKey: 'analysis.tabs.overview', icon: 'i-heroicons-chart-pie' },
  { id: 'view', labelKey: 'analysis.tabs.view', icon: 'i-heroicons-presentation-chart-bar' },
  { id: 'ai-chat', labelKey: 'analysis.tabs.aiChat', icon: 'i-heroicons-chat-bubble-left-ellipsis' },
  { id: 'lab', labelKey: 'analysis.tabs.lab', icon: 'i-heroicons-beaker' },
]
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
      icon-class="bg-gray-900 text-white dark:bg-gray-800 shadow-sm"
    >
      <template #actions>
        <UButton
          icon="i-lucide-refresh-cw"
          color="primary"
          variant="soft"
          size="sm"
          class="rounded-xl border border-pink-100 hover:border-pink-200 dark:border-pink-950/30 dark:hover:border-pink-900/50"
          :loading="isRecomputing"
          @click="recomputeContacts"
        >
          {{ t('contacts.actions.recompute') }}
        </UButton>
      </template>

      <!-- 仿聊天分析页的 Tab 菜单栏与统计信息 -->
      <div class="mt-3 flex items-center justify-between gap-3 pb-1.5">
        <div class="flex shrink-0 items-center gap-0.5 overflow-x-auto scrollbar-hide">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all"
            :class="[
              activeTab === tab.id
                ? 'bg-pink-500 text-white dark:bg-pink-900/30 dark:text-pink-300'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
            ]"
            @click="activeTab = tab.id"
          >
            <UIcon :name="tab.icon" class="h-3.5 w-3.5" />
            <span class="whitespace-nowrap">{{ t(tab.labelKey) }}</span>
          </button>
        </div>

        <!-- 统计指标面板 -->
        <div class="hidden items-center gap-5 text-[11px] sm:flex">
          <div class="flex items-center gap-1.5">
            <span class="text-gray-400 dark:text-gray-500">{{ t('contacts.stats.total') }}</span>
            <span class="font-mono font-bold text-gray-900 dark:text-white">{{ stats.total }}</span>
          </div>
          <div class="h-3 w-px bg-gray-250 dark:bg-white/10"></div>
          <div class="flex items-center gap-1.5">
            <span class="text-gray-400 dark:text-gray-500">{{ t('contacts.stats.core') }}</span>
            <span class="font-mono font-bold text-pink-600 dark:text-pink-400">{{ stats.core }}</span>
          </div>
          <div class="h-3 w-px bg-gray-250 dark:bg-white/10"></div>
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

    <div class="flex-1 min-w-0 overflow-y-auto">
      <main class="mx-auto flex w-full max-w-[1800px] flex-col gap-6 px-6 py-6 lg:px-8">
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
            <span>{{ t('contacts.stale.inline') }}</span>
          </div>
          <UButton
            size="xs"
            color="primary"
            variant="solid"
            class="rounded-xl"
            :loading="isRecomputing"
            @click="recomputeContacts"
          >
            {{ t('contacts.actions.recompute') }}
          </UButton>
        </div>

        <section v-if="activeTab === 'overview'" class="flex flex-col gap-4">
          <!-- 筛选与搜索控制栏 -->
          <div
            class="flex flex-col gap-3 rounded-2xl border border-gray-100/80 bg-white/60 p-3 shadow-[0_1px_2px_rgba(0,0,0,0.01)] dark:border-white/5 dark:bg-gray-900/20 lg:flex-row lg:items-center lg:justify-between lg:px-4"
          >
            <div class="min-w-0 flex-1 lg:max-w-sm">
              <UInput
                v-model="searchQuery"
                icon="i-lucide-search"
                :placeholder="t('contacts.search')"
                size="md"
                class="w-full"
              />
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <select
                v-model="poolFilter"
                class="h-10 cursor-pointer rounded-xl border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 shadow-sm transition hover:border-gray-300 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 dark:border-white/5 dark:bg-gray-900/60 dark:text-gray-300 dark:hover:border-white/10"
              >
                <option value="all">{{ t('contacts.filters.allPools') }}</option>
                <option value="friend">{{ t('contacts.filters.friends') }}</option>
                <option value="non_friend">{{ t('contacts.filters.nonFriends') }}</option>
              </select>
              <select
                v-model="tierFilter"
                class="h-10 cursor-pointer rounded-xl border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 shadow-sm transition hover:border-gray-300 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 dark:border-white/5 dark:bg-gray-900/60 dark:text-gray-300 dark:hover:border-white/10"
              >
                <option value="all">{{ t('contacts.filters.allTiers') }}</option>
                <option v-for="tier in tierOrder" :key="tier" :value="tier">{{ tierLabel(tier) }}</option>
              </select>
              <label
                class="flex h-10 cursor-pointer select-none items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 shadow-sm transition hover:bg-gray-50/50 dark:border-white/5 dark:bg-gray-900/60 dark:text-gray-300 dark:hover:border-gray-800/40"
              >
                <input
                  v-model="showLowInteraction"
                  type="checkbox"
                  class="h-3.5 w-3.5 rounded border-gray-300 text-pink-600 focus:ring-pink-500 dark:border-gray-700 dark:bg-gray-800"
                />
                <span>{{ t('contacts.filters.showLow') }}</span>
              </label>
            </div>
          </div>

          <!-- 加载骨架 -->
          <div
            v-if="isLoading"
            class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]"
          >
            <div class="space-y-8">
              <div v-for="g in 3" :key="g" class="space-y-4">
                <!-- 分组骨架标题 -->
                <div class="flex items-center gap-3">
                  <div class="h-5 w-20 animate-pulse rounded-lg bg-gray-100 dark:bg-white/5" />
                  <div class="h-4 w-10 animate-pulse rounded-lg bg-gray-50 dark:bg-white/5" />
                  <div class="h-px flex-1 bg-gray-100 dark:bg-white/5" />
                </div>
                <!-- 卡片骨架 -->
                <div class="contact-card-grid">
                  <div
                    v-for="i in 4"
                    :key="i"
                    class="h-[104px] animate-pulse rounded-2xl bg-gray-100 dark:bg-white/5"
                  />
                </div>
              </div>
            </div>
            <div class="hidden h-[560px] animate-pulse rounded-3xl bg-gray-50/50 dark:bg-white/5 lg:block" />
          </div>

          <div
            v-else-if="error"
            class="rounded-2xl border border-red-200 bg-red-50/50 p-4 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-300"
          >
            {{ error }}
          </div>

          <!-- 主体网格与详情 -->
          <div v-else class="grid min-h-0 gap-6 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
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

              <!-- 分组卡片列表 -->
              <section v-for="group in groupedContacts" :key="group.tier" class="space-y-4">
                <div class="flex items-center gap-3">
                  <span
                    class="rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wider"
                    :class="tierClasses(group.tier)"
                  >
                    {{ tierLabel(group.tier) }}
                  </span>
                  <span class="text-xs font-semibold text-gray-400 dark:text-gray-500">
                    {{ group.contacts.length }} 人
                  </span>
                  <div class="h-px flex-1 bg-gray-200/60 dark:bg-white/5"></div>
                </div>

                <div class="contact-card-grid">
                  <button
                    v-for="contact in group.contacts"
                    :key="contact.key"
                    type="button"
                    class="group relative flex h-[104px] w-full flex-col justify-between rounded-2xl border p-4 text-left transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgb(0,0,0,0.02)] dark:hover:shadow-[0_8px_30px_rgb(0,0,0,0.2)]"
                    :class="
                      selectedContact?.key === contact.key
                        ? 'border-pink-500 bg-pink-500/[0.02] dark:border-pink-500/80 dark:bg-pink-500/[0.01]'
                        : 'border-gray-200/80 bg-white hover:border-gray-300 dark:border-white/5 dark:bg-gray-900/20 dark:hover:border-white/10'
                    "
                    @click="selectContact(contact)"
                  >
                    <!-- 选中激活细杠 -->
                    <div
                      class="absolute left-0 top-1/4 h-1/2 w-1 rounded-r-full bg-pink-500 transition-all duration-300"
                      :class="selectedContact?.key === contact.key ? 'scale-100 opacity-100' : 'scale-75 opacity-0'"
                    ></div>

                    <div class="flex min-w-0 w-full items-start gap-3">
                      <div class="relative shrink-0 overflow-hidden rounded-xl">
                        <img
                          v-if="contact.avatar"
                          :src="contact.avatar"
                          :alt="contact.displayName"
                          class="h-10 w-10 object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        <div
                          v-else
                          class="flex h-10 w-10 items-center justify-center bg-gray-50 text-sm font-bold text-gray-500 transition-transform duration-300 group-hover:scale-105 dark:bg-gray-800/80 dark:text-gray-400"
                        >
                          {{ avatarText(contact) }}
                        </div>
                      </div>

                      <div class="min-w-0 flex-1">
                        <div class="flex min-w-0 items-center gap-1">
                          <span
                            class="truncate text-sm font-semibold tracking-tight text-gray-900 dark:text-white leading-tight"
                          >
                            {{ contact.displayName }}
                          </span>
                          <UIcon
                            v-if="contact.lockedTier"
                            name="i-lucide-lock"
                            class="h-3 w-3 shrink-0 text-pink-500"
                          />
                        </div>
                        <span class="mt-0.5 block truncate text-[11px] font-medium text-gray-400 dark:text-gray-500">
                          {{ contact.platform }}
                        </span>
                      </div>

                      <span
                        class="shrink-0 rounded-lg bg-gray-50 px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-gray-500 dark:bg-white/5 dark:text-gray-400"
                        :class="selectedContact?.key === contact.key ? 'text-pink-600 dark:text-pink-400' : ''"
                      >
                        {{ formatScore(contact.score) }}
                      </span>
                    </div>

                    <div
                      class="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-gray-400 dark:text-gray-500"
                    >
                      <UIcon
                        :name="contact.pool === 'friend' ? 'i-lucide-message-square' : 'i-lucide-users'"
                        class="h-3.5 w-3.5 shrink-0 text-gray-300 dark:text-gray-600"
                      />
                      <span v-if="contact.pool === 'friend'" class="min-w-0 truncate">
                        {{
                          t('contacts.metrics.privateMessages', {
                            count: formatCount(contact.scoreBreakdown.privateMessageCount),
                          })
                        }}
                      </span>
                      <span v-else class="min-w-0 truncate">
                        {{
                          t('contacts.metrics.groups', { count: formatCount(contact.scoreBreakdown.commonGroupCount) })
                        }}
                      </span>
                    </div>
                  </button>
                </div>
              </section>
            </section>

            <!-- 右侧详情区 -->
            <aside
              class="min-h-0 rounded-3xl border border-gray-100/80 bg-white/60 p-6 shadow-sm dark:border-white/5 dark:bg-gray-900/30 backdrop-blur-md lg:sticky lg:top-6 lg:self-start"
            >
              <template v-if="selectedContact">
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
                      {{ selectedContact.platformId }}
                    </p>
                  </div>
                </div>

                <div class="mt-4 flex flex-wrap gap-2">
                  <span class="rounded-lg px-2.5 py-1 text-xs font-semibold" :class="tierClasses(selectedContact.tier)">
                    {{ tierLabel(selectedContact.tier) }}
                  </span>
                  <span
                    class="rounded-lg bg-gray-100/80 px-2.5 py-1 text-xs font-semibold text-gray-600 dark:bg-white/5 dark:text-gray-300"
                  >
                    {{ selectedContact.pool === 'friend' ? t('contacts.pool.friend') : t('contacts.pool.nonFriend') }}
                  </span>
                </div>

                <!-- 双栏卡片（得分、最近互动） -->
                <div class="mt-6 grid grid-cols-2 gap-4">
                  <div
                    class="rounded-2xl border border-gray-100 bg-white/80 p-4 dark:border-white/5 dark:bg-gray-900/40"
                  >
                    <span class="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 block">
                      {{ t('contacts.detail.score') }}
                    </span>
                    <span class="mt-2 text-2xl font-bold tracking-tight text-pink-600 dark:text-pink-400 font-mono">
                      {{ formatScore(selectedContact.score) }}
                    </span>
                  </div>
                  <div
                    class="rounded-2xl border border-gray-100 bg-white/80 p-4 dark:border-white/5 dark:bg-gray-900/40"
                  >
                    <span class="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 block">
                      {{ t('contacts.detail.lastInteraction') }}
                    </span>
                    <span class="mt-2.5 block truncate text-xs font-bold text-gray-800 dark:text-gray-200">
                      {{ formatTime(selectedContact.lastInteractionTs) }}
                    </span>
                  </div>
                </div>

                <!-- 统计数值列表 -->
                <div
                  class="mt-6 rounded-2xl border border-gray-100 bg-white/80 p-4 dark:border-white/5 dark:bg-gray-900/40 space-y-4"
                >
                  <div class="flex items-center justify-between text-xs font-medium">
                    <div class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                      <UIcon name="i-lucide-message-circle" class="h-4 w-4 text-gray-400" />
                      <span>{{ t('contacts.metrics.privateMessagesLabel') }}</span>
                    </div>
                    <span class="font-mono font-bold text-gray-900 dark:text-white">
                      {{ formatCount(selectedContact.scoreBreakdown.privateMessageCount) }}
                    </span>
                  </div>
                  <div class="h-px bg-gray-50 dark:bg-white/5" />
                  <div class="flex items-center justify-between text-xs font-medium">
                    <div class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                      <UIcon name="i-lucide-calendar" class="h-4 w-4 text-gray-400" />
                      <span>{{ t('contacts.metrics.activeMonths') }}</span>
                    </div>
                    <span class="font-mono font-bold text-gray-900 dark:text-white">
                      {{ formatCount(selectedContact.scoreBreakdown.activePrivateMonths) }}
                    </span>
                  </div>
                  <div class="h-px bg-gray-50 dark:bg-white/5" />
                  <div class="flex items-center justify-between text-xs font-medium">
                    <div class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                      <UIcon name="i-lucide-users-2" class="h-4 w-4 text-gray-400" />
                      <span>{{ t('contacts.metrics.commonGroups') }}</span>
                    </div>
                    <span class="font-mono font-bold text-gray-900 dark:text-white">
                      {{ formatCount(selectedContact.scoreBreakdown.commonGroupCount) }}
                    </span>
                  </div>
                  <div class="h-px bg-gray-50 dark:bg-white/5" />
                  <div class="flex items-center justify-between text-xs font-medium">
                    <div class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                      <UIcon name="i-lucide-eye" class="h-4 w-4 text-gray-400" />
                      <span>{{ t('contacts.metrics.coOccurrence') }}</span>
                    </div>
                    <span class="font-mono font-bold text-gray-900 dark:text-white">
                      {{ formatCount(selectedContact.scoreBreakdown.coOccurrenceCount) }}
                    </span>
                  </div>
                  <div class="h-px bg-gray-50 dark:bg-white/5" />
                  <div class="flex items-center justify-between text-xs font-medium">
                    <div class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                      <UIcon name="i-lucide-reply" class="h-4 w-4 text-gray-400" />
                      <span>{{ t('contacts.metrics.replies') }}</span>
                    </div>
                    <span class="font-mono font-bold text-gray-900 dark:text-white">
                      {{ formatCount(selectedContact.scoreBreakdown.replyInteractionCount) }}
                    </span>
                  </div>
                </div>

                <!-- 操作区 -->
                <div class="mt-6 flex gap-2">
                  <UButton
                    v-if="selectedContact.lockedTier !== 'core'"
                    icon="i-lucide-lock"
                    size="md"
                    color="primary"
                    variant="soft"
                    class="flex-1 rounded-xl justify-center h-10"
                    :loading="pendingOverrideKey === selectedContact.key"
                    @click="lockAsCore(selectedContact)"
                  >
                    {{ t('contacts.actions.lockCore') }}
                  </UButton>
                  <UButton
                    v-else
                    icon="i-lucide-lock-open"
                    size="md"
                    color="neutral"
                    variant="soft"
                    class="flex-1 rounded-xl justify-center h-10 border border-gray-200 dark:border-white/5"
                    :loading="pendingOverrideKey === selectedContact.key"
                    @click="unlockTier(selectedContact)"
                  >
                    {{ t('contacts.actions.unlock') }}
                  </UButton>
                </div>

                <!-- 来源会话列表 -->
                <div class="mt-8 border-t border-gray-100 pt-6 dark:border-white/5">
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
                          class="flex items-center gap-1 text-[10px] font-bold text-gray-400 dark:text-gray-500 transition group-hover/item:text-pink-500"
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
                </div>
              </template>
            </aside>
          </div>
        </section>

        <!-- 功能建设中 Placeholder -->
        <section
          v-else
          class="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-gray-200 bg-white/40 p-16 text-center dark:border-white/5 dark:bg-gray-900/10 min-h-[400px]"
        >
          <div
            class="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-50 text-gray-400 dark:bg-white/5 dark:text-gray-500"
          >
            <UIcon :name="tabs.find((t) => t.id === activeTab)?.icon || 'i-heroicons-beaker'" class="h-6 w-6" />
          </div>
          <h3 class="mt-4 text-sm font-semibold text-gray-900 dark:text-white">
            {{ tabs.find((t) => t.id === activeTab) ? t(tabs.find((t) => t.id === activeTab)!.labelKey) : '' }}
            功能建设中
          </h3>
          <p class="mt-1.5 text-xs text-gray-450 dark:text-gray-500">
            该维度的联系人分析与互动透视功能正在积极建设中，敬请期待。
          </p>
        </section>
      </main>
    </div>

    <UModal v-model:open="showRecomputePrompt" :ui="{ content: 'max-w-md' }">
      <template #content>
        <div class="p-4">
          <h3 class="font-semibold text-gray-900 dark:text-white">{{ t('contacts.stale.title') }}</h3>
          <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">{{ t('contacts.stale.message') }}</p>
          <div class="mt-4 flex justify-end gap-2">
            <UButton variant="soft" @click="showRecomputePrompt = false">{{ t('contacts.stale.later') }}</UButton>
            <UButton color="primary" :loading="isRecomputing" @click="recomputeContacts">
              {{ t('contacts.actions.recompute') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.contact-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 228px), 1fr));
  gap: 12px;
}
</style>
