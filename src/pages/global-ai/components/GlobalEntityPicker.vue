<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AIEntityRef, ContactListItem, ContactsResponse } from '@openchatlab/shared-types'
import { useDataService } from '@/services'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{
  modelValue: AIEntityRef[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: AIEntityRef[]]
}>()

const { t } = useI18n()
const dataService = useDataService()
const sessionStore = useSessionStore()
const open = ref(false)
const activeType = ref<'contacts' | 'groups'>('contacts')
const query = ref('')
const contacts = ref<ContactListItem[]>([])
const contactResponses = ref<ContactsResponse[]>([])
const loadingContacts = ref(false)
const contactError = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null
let requestId = 0

const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase())
const groups = computed(() => {
  const list = sessionStore.sessions.filter((session) => session.type === 'group')
  if (!normalizedQuery.value) return list
  return list.filter((session) => session.name.toLocaleLowerCase().includes(normalizedQuery.value))
})
const contactsUnavailable = computed(
  () =>
    !loadingContacts.value &&
    !contactError.value &&
    contacts.value.length === 0 &&
    contactResponses.value.some(
      (response) => response.cache.status === 'missing' || response.task?.status === 'running'
    )
)

function entityKey(entity: AIEntityRef): string {
  return entity.type === 'contact' ? `contact:${entity.contactKey}` : `session:${entity.sessionId}`
}

function isSelected(entity: AIEntityRef): boolean {
  const key = entityKey(entity)
  return props.modelValue.some((item) => entityKey(item) === key)
}

function toggle(entity: AIEntityRef): void {
  if (props.disabled) return
  const key = entityKey(entity)
  const exists = props.modelValue.some((item) => entityKey(item) === key)
  emit(
    'update:modelValue',
    exists ? props.modelValue.filter((item) => entityKey(item) !== key) : [...props.modelValue, entity]
  )
}

function remove(entity: AIEntityRef): void {
  const key = entityKey(entity)
  emit(
    'update:modelValue',
    props.modelValue.filter((item) => entityKey(item) !== key)
  )
}

async function loadContacts(): Promise<void> {
  const currentRequest = ++requestId
  loadingContacts.value = true
  contactError.value = ''
  try {
    const options = {
      acceptStale: true,
      page: 1,
      pageSize: 100,
      query: query.value.trim() || undefined,
    } as const
    const responses = await Promise.all([
      dataService.getContacts({ ...options, pool: 'friend' }),
      dataService.getContacts({ ...options, pool: 'non_friend' }),
    ])
    if (currentRequest !== requestId) return

    const byKey = new Map<string, ContactListItem>()
    responses.flatMap((response) => response.contacts).forEach((contact) => byKey.set(contact.key, contact))
    contacts.value = [...byKey.values()]
    contactResponses.value = responses
  } catch (error) {
    if (currentRequest !== requestId) return
    contactError.value = error instanceof Error ? error.message : String(error)
    contacts.value = []
    contactResponses.value = []
  } finally {
    if (currentRequest === requestId) loadingContacts.value = false
  }
}

watch(open, (isOpen) => {
  if (isOpen) void loadContacts()
})

watch(query, () => {
  if (!open.value || activeType.value !== 'contacts') return
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void loadContacts(), 250)
})
</script>

<template>
  <div class="flex min-w-0 flex-wrap items-center gap-1.5">
    <UPopover v-model:open="open" :ui="{ content: 'z-[80] p-0' }">
      <button
        type="button"
        class="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        :disabled="disabled"
        :title="t('ai.global.entityPicker.title')"
      >
        <span class="text-base leading-none">@</span>
        <span>{{ t('ai.global.entityPicker.add') }}</span>
      </button>

      <template #content>
        <div class="flex h-[390px] w-[340px] flex-col overflow-hidden">
          <div class="border-b border-gray-200 p-3 dark:border-gray-800">
            <div class="mb-2 flex rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
              <button
                v-for="type in ['contacts', 'groups'] as const"
                :key="type"
                type="button"
                class="flex-1 rounded-md px-3 py-1.5 text-xs transition-colors"
                :class="
                  activeType === type
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                    : 'text-gray-500 dark:text-gray-400'
                "
                @click="activeType = type"
              >
                {{ t(`ai.global.entityPicker.${type}`) }}
              </button>
            </div>
            <UInput
              v-model="query"
              icon="i-heroicons-magnifying-glass"
              size="sm"
              :placeholder="t('ai.global.entityPicker.search')"
            />
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto p-2">
            <template v-if="activeType === 'contacts'">
              <div v-if="loadingContacts" class="flex h-full items-center justify-center">
                <UIcon name="i-lucide-loader-2" class="h-4 w-4 animate-spin text-gray-400" />
              </div>
              <div v-else-if="contactError" class="px-3 py-8 text-center text-xs text-red-500">
                <p>{{ t('ai.global.entityPicker.loadFailed') }}</p>
                <UButton size="xs" variant="link" class="mt-1" @click="loadContacts">
                  {{ t('common.retry') }}
                </UButton>
              </div>
              <div v-else-if="contactsUnavailable" class="px-4 py-8 text-center text-xs text-gray-400">
                {{ t('ai.global.entityPicker.contactsPreparing') }}
              </div>
              <div v-else-if="contacts.length === 0" class="px-4 py-8 text-center text-xs text-gray-400">
                {{ t('ai.global.entityPicker.empty') }}
              </div>
              <button
                v-for="contact in contacts"
                v-else
                :key="contact.key"
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                @click="
                  toggle({
                    type: 'contact',
                    contactKey: contact.key,
                    displayName: contact.displayName,
                  })
                "
              >
                <div
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs text-primary-600 dark:bg-primary-500/10 dark:text-primary-300"
                >
                  {{ contact.displayName.slice(0, 1) }}
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm text-gray-700 dark:text-gray-200">{{ contact.displayName }}</p>
                  <p class="truncate text-[11px] text-gray-400">{{ contact.platform }}</p>
                </div>
                <UIcon
                  v-if="
                    isSelected({
                      type: 'contact',
                      contactKey: contact.key,
                      displayName: contact.displayName,
                    })
                  "
                  name="i-heroicons-check"
                  class="h-4 w-4 shrink-0 text-primary-500"
                />
              </button>
            </template>

            <template v-else>
              <div v-if="groups.length === 0" class="px-4 py-8 text-center text-xs text-gray-400">
                {{ t('ai.global.entityPicker.empty') }}
              </div>
              <button
                v-for="session in groups"
                :key="session.id"
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                @click="
                  toggle({
                    type: 'session',
                    sessionId: session.id,
                    displayName: session.name,
                    sessionType: 'group',
                  })
                "
              >
                <div
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300"
                >
                  <UIcon name="i-heroicons-user-group" class="h-4 w-4" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm text-gray-700 dark:text-gray-200">{{ session.name }}</p>
                  <p class="text-[11px] text-gray-400">{{ session.platform }}</p>
                </div>
                <UIcon
                  v-if="
                    isSelected({
                      type: 'session',
                      sessionId: session.id,
                      displayName: session.name,
                      sessionType: 'group',
                    })
                  "
                  name="i-heroicons-check"
                  class="h-4 w-4 shrink-0 text-primary-500"
                />
              </button>
            </template>
          </div>
        </div>
      </template>
    </UPopover>

    <span
      v-for="entity in modelValue"
      :key="entityKey(entity)"
      class="inline-flex h-7 max-w-[180px] items-center gap-1 rounded-full bg-primary-50 px-2 text-xs text-primary-700 dark:bg-primary-500/10 dark:text-primary-300"
    >
      <UIcon :name="entity.type === 'contact' ? 'i-heroicons-user' : 'i-heroicons-user-group'" class="h-3 w-3" />
      <span class="truncate">{{ entity.displayName }}</span>
      <button
        type="button"
        class="ml-0.5 rounded-full text-primary-400 hover:text-primary-700 dark:hover:text-primary-200"
        :aria-label="t('common.delete')"
        :disabled="disabled"
        @click="remove(entity)"
      >
        <UIcon name="i-heroicons-x-mark" class="h-3 w-3" />
      </button>
    </span>
  </div>
</template>
