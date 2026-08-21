<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import AIChatComposer from './AIChatComposer.vue'
import SlashCommandMenu from './SlashCommandMenu.vue'
import { useSkillStore, type SkillSummary } from '@/stores/skill'
import { useSessionStore } from '@/stores/session'
import type { MentionedMemberContext } from '@/composables/useAIChat'
import type { MemberWithStats } from '@/types/analysis'
import { useDataService } from '@/services'
import type { AIEntityRef, ContactListItem, ContactsResponse } from '@openchatlab/shared-types'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    sessionId?: string
    disabled?: boolean
    status?: 'ready' | 'submitted' | 'streaming' | 'error'
    chatType?: 'group' | 'private'
    mentionScope?: 'session' | 'global'
    skillsEnabled?: boolean
    placeholder?: string
    embedded?: boolean
  }>(),
  {
    sessionId: '',
    chatType: 'group',
    mentionScope: 'session',
    skillsEnabled: true,
    placeholder: '',
    embedded: false,
  }
)

const emit = defineEmits<{
  send: [payload: { content: string; mentionedMembers: MentionedMemberContext[]; entityRefs: AIEntityRef[] }]
  stop: []
  manageSkills: []
  skillActivated: [skill: SkillSummary]
}>()

interface MentionCandidate {
  key: string
  displayName: string
  insertName: string
  avatar: string | null
  searchText: string
  mentionText: string
  mentionedMember?: MentionedMemberContext
  entityRef?: AIEntityRef
}

interface MentionMenuItem {
  id: string
  label: string
  avatar: string | null
  searchText: string
}

type MentionTab = 'contact' | 'group'

const skillStore = useSkillStore()
const sessionStore = useSessionStore()
const { compatibleSkills, activeSkill, activeSkillId, isLoaded } = storeToRefs(skillStore)

const rootRef = ref<HTMLElement | null>(null)
const composerRef = ref<InstanceType<typeof AIChatComposer> | null>(null)
const inputValue = ref('')
const mentionMembers = ref<MemberWithStats[]>([])
const globalMentionCandidates = ref<MentionCandidate[]>([])
const mentionRegistry = new Map<string, MentionCandidate>()
const selectedMentionIds = ref<string[]>([])
const mentionSearchTerm = ref('')
const mentionTab = ref<MentionTab>('contact')
const showSlashMenu = ref(false)
const slashFilter = ref('')
const slashHighlightIndex = ref(0)
const isComposing = ref(false)
const dismissedSlashValue = ref<string | null>(null)
let globalMentionSearchTimer: ReturnType<typeof setTimeout> | null = null
let globalMentionPollTimer: ReturnType<typeof setTimeout> | null = null
let globalMentionRequestId = 0
const GLOBAL_MENTION_POLL_INTERVAL_MS = 1500

const canSubmit = computed(() => inputValue.value.trim().length > 0 && !props.disabled)
const inputPlaceholder = computed(() => {
  if (props.placeholder) return props.placeholder
  if (props.skillsEnabled && activeSkill.value && inputValue.value.trim().length === 0) {
    return t('ai.chat.input.placeholderWithActiveSkill', { name: activeSkill.value.name })
  }
  return t('ai.chat.input.placeholderWithSlash')
})
const sendButtonTitle = computed(() => {
  if (props.status === 'streaming') return ''
  if (canSubmit.value) return t('ai.chat.input.send')
  if (props.skillsEnabled && activeSkill.value) return t('ai.chat.input.needMoreThanSkill')
  return t('ai.chat.input.needQuestion')
})

const sessionMentionCandidates = computed<MentionCandidate[]>(() => {
  const nameCount = new Map<string, number>()

  mentionMembers.value.forEach((member) => {
    const baseName = member.groupNickname || member.accountName || member.platformId
    nameCount.set(baseName, (nameCount.get(baseName) ?? 0) + 1)
  })

  return mentionMembers.value.map((member) => {
    const displayName = member.groupNickname || member.accountName || member.platformId
    const insertName = (nameCount.get(displayName) ?? 0) > 1 ? `${displayName}·${member.platformId}` : displayName
    return {
      key: `member:${props.sessionId}:${member.id}`,
      displayName,
      avatar: member.avatar,
      mentionText: `@${insertName}`,
      insertName,
      mentionedMember: {
        memberId: member.id,
        platformId: member.platformId,
        displayName,
        aliases: [...member.aliases],
        mentionText: `@${insertName}`,
      },
      searchText: [
        displayName,
        member.groupNickname || '',
        member.accountName || '',
        member.platformId,
        insertName,
        member.aliases.join(' '),
      ]
        .join(' ')
        .toLocaleLowerCase(),
    }
  })
})

const mentionCandidates = computed(() => {
  if (props.mentionScope !== 'global') return sessionMentionCandidates.value
  return globalMentionCandidates.value.filter((candidate) =>
    mentionTab.value === 'contact' ? candidate.entityRef?.type === 'contact' : candidate.entityRef?.type === 'session'
  )
})

const mentionMenuItems = computed<MentionMenuItem[]>(() => {
  const keyword = mentionSearchTerm.value.trim().toLocaleLowerCase()
  const candidates =
    props.mentionScope === 'global' && keyword
      ? mentionCandidates.value.filter((candidate) => candidate.searchText.includes(keyword))
      : mentionCandidates.value

  return candidates.map((candidate) => ({
    id: candidate.key,
    label: candidate.insertName,
    avatar: candidate.avatar,
    searchText: candidate.searchText,
  }))
})

const filteredSkills = computed(() => {
  if (!props.skillsEnabled) return []
  const keyword = slashFilter.value.trim().toLocaleLowerCase()
  if (!keyword) return compatibleSkills.value

  return compatibleSkills.value.filter((skill) => {
    const haystack = [skill.name, skill.description, skill.tags.join(' ')].join(' ').toLocaleLowerCase()
    return haystack.includes(keyword)
  })
})

function focusEditor() {
  composerRef.value?.focus('end')
}

async function loadMentionMembers() {
  if (props.mentionScope !== 'session' || !props.sessionId) {
    mentionMembers.value = []
    return
  }

  try {
    const members = await useDataService().getMembers(props.sessionId)
    mentionMembers.value = [...members].sort((a, b) => b.messageCount - a.messageCount)
  } catch (error) {
    console.error('Failed to load AI mention members:', error)
    mentionMembers.value = []
  }
}

function buildGlobalMentionCandidates(contacts: ContactListItem[], query: string): MentionCandidate[] {
  const groupLabel = t('ai.global.entityPicker.groups')
  const rawCandidates = [
    ...contacts.map((contact) => ({
      key: `contact:${contact.key}`,
      displayName: contact.displayName,
      avatar: contact.avatar,
      duplicateSuffix: contact.platformId,
      searchText: [contact.displayName, contact.platformId, contact.aliases.join(' ')].join(' ').toLocaleLowerCase(),
      entityRef: {
        type: 'contact' as const,
        contactKey: contact.key,
        displayName: contact.displayName,
      },
    })),
    ...sessionStore.sessions
      .filter((session) => session.type === 'group')
      .map((session) => ({
        key: `session:${session.id}`,
        displayName: session.name,
        avatar: session.groupAvatar,
        duplicateSuffix: groupLabel,
        searchText: [session.name, session.platform].join(' ').toLocaleLowerCase(),
        entityRef: {
          type: 'session' as const,
          sessionId: session.id,
          displayName: session.name,
          sessionType: 'group' as const,
        },
      })),
  ]

  const keyword = query.trim().toLocaleLowerCase()
  const filteredCandidates = keyword
    ? rawCandidates.filter((candidate) => candidate.searchText.includes(keyword))
    : rawCandidates
  const nameCount = new Map<string, number>()
  filteredCandidates.forEach((candidate) => {
    nameCount.set(candidate.displayName, (nameCount.get(candidate.displayName) ?? 0) + 1)
  })

  return filteredCandidates.map((candidate) => {
    const insertName =
      (nameCount.get(candidate.displayName) ?? 0) > 1
        ? `${candidate.displayName}·${candidate.duplicateSuffix}`
        : candidate.displayName
    return {
      key: candidate.key,
      displayName: candidate.displayName,
      insertName,
      avatar: candidate.avatar,
      searchText: candidate.searchText,
      mentionText: `@${insertName}`,
      entityRef: candidate.entityRef,
    }
  })
}

async function loadGlobalMentionCandidates(query: string) {
  const requestId = ++globalMentionRequestId
  try {
    const options = {
      acceptStale: true,
      timeRangePreset: 'all',
      page: 1,
      pageSize: 100,
      query: query.trim() || undefined,
    } as const
    const responses = await Promise.all([
      useDataService().getContacts({ ...options, pool: 'friend' }),
      useDataService().getContacts({ ...options, pool: 'non_friend' }),
    ])
    if (requestId !== globalMentionRequestId) return

    const contactsByKey = new Map<string, ContactListItem>()
    responses.flatMap((response) => response.contacts).forEach((contact) => contactsByKey.set(contact.key, contact))
    globalMentionCandidates.value = buildGlobalMentionCandidates([...contactsByKey.values()], query)
    scheduleGlobalMentionPolling(responses, query)
  } catch (error) {
    if (requestId !== globalMentionRequestId) return
    stopGlobalMentionPolling()
    console.error('Failed to load global AI mention candidates:', error)
    globalMentionCandidates.value = buildGlobalMentionCandidates([], query)
  }
}

function stopGlobalMentionPolling() {
  if (!globalMentionPollTimer) return
  clearTimeout(globalMentionPollTimer)
  globalMentionPollTimer = null
}

function scheduleGlobalMentionPolling(responses: ContactsResponse[], query: string) {
  stopGlobalMentionPolling()
  if (props.mentionScope !== 'global') return
  if (!responses.some((response) => response.task?.status === 'running')) return

  globalMentionPollTimer = setTimeout(() => {
    globalMentionPollTimer = null
    void loadGlobalMentionCandidates(query)
  }, GLOBAL_MENTION_POLL_INTERVAL_MS)
}

function scheduleGlobalMentionSearch(query: string) {
  if (globalMentionSearchTimer) clearTimeout(globalMentionSearchTimer)
  stopGlobalMentionPolling()
  globalMentionRequestId++
  globalMentionSearchTimer = setTimeout(
    () => {
      globalMentionSearchTimer = null
      void loadGlobalMentionCandidates(query)
    },
    query ? 200 : 0
  )
}

function resetSlashState() {
  showSlashMenu.value = false
  slashFilter.value = ''
  slashHighlightIndex.value = 0
}

function dismissSlashMenu() {
  if (/^\s*\/([^\n]*)$/.test(inputValue.value)) {
    dismissedSlashValue.value = inputValue.value
  }
  resetSlashState()
}

function updateSlashState(value: string) {
  if (props.disabled || !props.skillsEnabled) {
    resetSlashState()
    return
  }

  if (dismissedSlashValue.value && dismissedSlashValue.value !== value) {
    dismissedSlashValue.value = null
  }

  const match = value.match(/^\s*\/([^\n]*)$/)
  if (!match) {
    resetSlashState()
    return
  }

  const shouldResetHighlight = !showSlashMenu.value || slashFilter.value !== match[1]
  slashFilter.value = match[1]

  if (dismissedSlashValue.value === value) {
    showSlashMenu.value = false
    return
  }

  showSlashMenu.value = true
  if (shouldResetHighlight) slashHighlightIndex.value = 0
}

function clearActiveSkill() {
  skillStore.activateSkill(null)
  nextTick(focusEditor)
}

function openSkillSelector() {
  if (props.disabled || !props.skillsEnabled) return
  if (activeSkillId.value) skillStore.activateSkill(null)

  dismissedSlashValue.value = null
  inputValue.value = '/'
  nextTick(focusEditor)
}

function fillInput(content: string) {
  if (props.disabled) return

  dismissedSlashValue.value = null
  inputValue.value = content
  nextTick(focusEditor)
}

function handleMentionsChange(ids: string[]) {
  selectedMentionIds.value = ids
}

function handleMentionSearchTerm(value: string) {
  mentionSearchTerm.value = value
  if (props.mentionScope === 'global') scheduleGlobalMentionSearch(value)
}

function handleSubmit() {
  if (!canSubmit.value) return

  const candidates = selectedMentionIds.value.flatMap((id) => {
    const candidate = mentionRegistry.get(id)
    return candidate ? [candidate] : []
  })

  emit('send', {
    content: inputValue.value.trim(),
    mentionedMembers: candidates.flatMap((candidate) =>
      candidate.mentionedMember
        ? [{ ...candidate.mentionedMember, aliases: [...candidate.mentionedMember.aliases] }]
        : []
    ),
    entityRefs: candidates.flatMap((candidate) => (candidate.entityRef ? [{ ...candidate.entityRef }] : [])),
  })

  inputValue.value = ''
  selectedMentionIds.value = []
  mentionSearchTerm.value = ''
  dismissedSlashValue.value = null

  if (props.skillsEnabled && activeSkillId.value) {
    skillStore.activateSkill(null)
  }
}

function handleSelectSkill(skill: SkillSummary) {
  if (props.disabled) return

  skillStore.activateSkill(skill.id)
  emit('skillActivated', skill)
  inputValue.value = ''
  dismissedSlashValue.value = null
  resetSlashState()
  nextTick(focusEditor)
}

function handleManageSkills() {
  dismissSlashMenu()
  emit('manageSkills')
}

function moveSlashHighlight(step: 1 | -1) {
  if (!filteredSkills.value.length) return
  const total = filteredSkills.value.length
  slashHighlightIndex.value = (slashHighlightIndex.value + step + total) % total
}

function handleKeydown(event: KeyboardEvent) {
  if (props.skillsEnabled && event.key === 'Backspace' && inputValue.value.length === 0 && activeSkillId.value) {
    event.preventDefault()
    clearActiveSkill()
    return
  }

  if (showSlashMenu.value) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveSlashHighlight(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveSlashHighlight(-1)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      dismissSlashMenu()
      return
    }
    if ((event.key === 'Enter' && !event.shiftKey && !isComposing.value) || event.key === 'Tab') {
      event.preventDefault()
      const skill = filteredSkills.value[slashHighlightIndex.value]
      if (skill) handleSelectSkill(skill)
      return
    }
  }

  if (event.key === 'Enter' && !event.shiftKey && !isComposing.value && !event.isComposing) {
    event.preventDefault()
    handleSubmit()
  }
}

function handleDocumentMouseDown(event: MouseEvent) {
  if (!showSlashMenu.value || !rootRef.value) return
  const target = event.target
  if (target instanceof Node && !rootRef.value.contains(target)) dismissSlashMenu()
}

watch(inputValue, updateSlashState)

watch(
  mentionCandidates,
  (candidates) => {
    candidates.forEach((candidate) => mentionRegistry.set(candidate.key, candidate))
  },
  { immediate: true }
)

watch(
  filteredSkills,
  (skills) => {
    if (skills.length === 0) {
      slashHighlightIndex.value = 0
    } else if (slashHighlightIndex.value >= skills.length) {
      slashHighlightIndex.value = skills.length - 1
    }
  },
  { immediate: true }
)

watch(
  () => [props.chatType, props.skillsEnabled] as const,
  ([chatType, skillsEnabled]) => {
    if (skillsEnabled) skillStore.setFilterContext(chatType)
  },
  { immediate: true }
)

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) dismissSlashMenu()
  }
)

watch(
  () => [props.sessionId, props.mentionScope] as const,
  () => {
    selectedMentionIds.value = []
    mentionSearchTerm.value = ''
    void loadMentionMembers()
    stopGlobalMentionPolling()
    globalMentionRequestId++

    if (props.mentionScope === 'global') {
      globalMentionCandidates.value = buildGlobalMentionCandidates([], '')
      void loadGlobalMentionCandidates('')
    } else {
      globalMentionCandidates.value = []
    }
  },
  { immediate: true }
)

onMounted(async () => {
  if (props.skillsEnabled && !isLoaded.value) {
    await skillStore.loadSkills()
  }
  document.addEventListener('mousedown', handleDocumentMouseDown)
})

onBeforeUnmount(() => {
  if (globalMentionSearchTimer) clearTimeout(globalMentionSearchTimer)
  stopGlobalMentionPolling()
  globalMentionRequestId += 1
  document.removeEventListener('mousedown', handleDocumentMouseDown)
})

defineExpose({
  fillInput,
  openSkillSelector,
})
</script>

<template>
  <div class="shrink-0" :class="[props.embedded ? '' : 'pt-2 pb-2']">
    <div ref="rootRef" class="w-full max-w-4xl mx-auto" :class="{ relative: !props.embedded }">
      <SlashCommandMenu
        v-if="props.skillsEnabled"
        :visible="showSlashMenu"
        :skills="filteredSkills"
        :highlight-index="slashHighlightIndex"
        :active-skill-id="activeSkillId"
        @select="handleSelectSkill"
        @close="dismissSlashMenu"
        @manage="handleManageSkills"
        @highlight="slashHighlightIndex = $event"
      />

      <AIChatComposer
        ref="composerRef"
        v-model="inputValue"
        :disabled="props.disabled"
        :status="props.status"
        :placeholder="inputPlaceholder"
        :send-button-title="sendButtonTitle"
        :active-skill-name="props.skillsEnabled ? activeSkill?.name : undefined"
        :mention-items="mentionMenuItems"
        :mention-search-term="mentionSearchTerm"
        :async-mention-search="props.mentionScope === 'global'"
        :show-mention-tabs="props.mentionScope === 'global'"
        :mention-tab="mentionTab"
        :contact-tab-label="t('ai.global.entityPicker.contacts')"
        :group-tab-label="t('ai.global.entityPicker.groups')"
        :embedded="props.embedded"
        @update:mention-search-term="handleMentionSearchTerm"
        @update:mention-tab="mentionTab = $event"
        @mentions-change="handleMentionsChange"
        @submit="handleSubmit"
        @stop="emit('stop')"
        @keydown="handleKeydown"
        @composition-start="isComposing = true"
        @composition-end="isComposing = false"
      />
    </div>
  </div>
</template>
