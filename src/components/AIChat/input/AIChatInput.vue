<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import AIChatComposer from './AIChatComposer.vue'
import MemberMentionMenu from './MemberMentionMenu.vue'
import SlashCommandMenu from './SlashCommandMenu.vue'
import { useSkillStore, type SkillSummary } from '@/stores/skill'
import type { MentionedMemberContext } from '@/composables/useAIChat'
import type { MemberWithStats } from '@/types/analysis'
import { useDataService } from '@/services'

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
  disabled?: boolean
  status?: 'ready' | 'submitted' | 'streaming' | 'error'
  chatType: 'group' | 'private'
}>()

const emit = defineEmits<{
  send: [payload: { content: string; mentionedMembers: MentionedMemberContext[] }]
  stop: []
  manageSkills: []
  skillActivated: [skill: SkillSummary]
}>()

interface MentionCandidate extends MentionedMemberContext {
  insertName: string
  subtitle: string
  searchText: string
}

interface MentionRange {
  start: number
  end: number
  rawToken: string
}

const skillStore = useSkillStore()
const { compatibleSkills, activeSkill, activeSkillId, isLoaded } = storeToRefs(skillStore)

const rootRef = ref<HTMLElement | null>(null)
const composerRef = ref<InstanceType<typeof AIChatComposer> | null>(null)
const inputValue = ref('')
const mentionMembers = ref<MemberWithStats[]>([])
const selectedMentions = ref<MentionedMemberContext[]>([])
const isLoadingMentionMembers = ref(false)
const showSlashMenu = ref(false)
const slashFilter = ref('')
const slashHighlightIndex = ref(0)
const showMentionMenu = ref(false)
const mentionFilter = ref('')
const mentionHighlightIndex = ref(0)
const mentionRange = ref<MentionRange | null>(null)
const isComposing = ref(false)
const dismissedSlashValue = ref<string | null>(null)
const dismissedMentionToken = ref<string | null>(null)
const suspendInputParsing = ref(false)

const canSubmit = computed(() => inputValue.value.trim().length > 0 && !props.disabled)
const inputPlaceholder = computed(() => {
  if (activeSkill.value && inputValue.value.trim().length === 0) {
    return t('ai.chat.input.placeholderWithActiveSkill', { name: activeSkill.value.name })
  }
  return t('ai.chat.input.placeholderWithSlash')
})
const sendButtonTitle = computed(() => {
  if (props.status === 'streaming') {
    return ''
  }
  if (canSubmit.value) {
    return t('ai.chat.input.send')
  }
  if (activeSkill.value) {
    return t('ai.chat.input.needMoreThanSkill')
  }
  return t('ai.chat.input.needQuestion')
})

const mentionCandidates = computed<MentionCandidate[]>(() => {
  const nameCount = new Map<string, number>()

  mentionMembers.value.forEach((member) => {
    const baseName = member.groupNickname || member.accountName || member.platformId
    nameCount.set(baseName, (nameCount.get(baseName) ?? 0) + 1)
  })

  return mentionMembers.value.map((member) => {
    const displayName = member.groupNickname || member.accountName || member.platformId
    const insertName = (nameCount.get(displayName) ?? 0) > 1 ? `${displayName}·${member.platformId}` : displayName
    const subtitleParts = [member.platformId]

    if (member.aliases.length > 0) {
      subtitleParts.push(member.aliases.join(' / '))
    }

    return {
      memberId: member.id,
      platformId: member.platformId,
      displayName,
      aliases: [...member.aliases],
      mentionText: `@${insertName}`,
      insertName,
      subtitle: subtitleParts.join(' · '),
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

const filteredSkills = computed(() => {
  const keyword = slashFilter.value.trim().toLocaleLowerCase()
  if (!keyword) return compatibleSkills.value

  return compatibleSkills.value.filter((skill) => {
    const haystack = [skill.name, skill.description, skill.tags.join(' ')].join(' ').toLocaleLowerCase()
    return haystack.includes(keyword)
  })
})

const filteredMentionCandidates = computed(() => {
  const keyword = mentionFilter.value.trim().toLocaleLowerCase()
  if (!keyword) return mentionCandidates.value
  return mentionCandidates.value.filter((member) => member.searchText.includes(keyword))
})

function syncTextareaHeight() {
  composerRef.value?.syncHeight()
}

function focusTextarea() {
  composerRef.value?.focus()
}

async function loadMentionMembers() {
  if (!props.sessionId) {
    mentionMembers.value = []
    return
  }

  isLoadingMentionMembers.value = true
  try {
    const members = await useDataService().getMembers(props.sessionId)
    mentionMembers.value = [...members].sort((a, b) => b.messageCount - a.messageCount)
  } catch (error) {
    console.error('加载 AI @ 成员列表失败:', error)
    mentionMembers.value = []
  } finally {
    isLoadingMentionMembers.value = false
  }
}

function resetSlashState() {
  showSlashMenu.value = false
  slashFilter.value = ''
  slashHighlightIndex.value = 0
}

function resetMentionState() {
  showMentionMenu.value = false
  mentionFilter.value = ''
  mentionHighlightIndex.value = 0
  mentionRange.value = null
}

function dismissSlashMenu() {
  if (/^\s*\/([^\n]*)$/.test(inputValue.value)) {
    dismissedSlashValue.value = inputValue.value
  }
  resetSlashState()
}

function dismissMentionMenu() {
  if (mentionRange.value) {
    dismissedMentionToken.value = mentionRange.value.rawToken
  }
  resetMentionState()
}

function updateSlashState(value: string) {
  if (props.disabled) {
    resetSlashState()
    return
  }

  if (dismissedSlashValue.value && dismissedSlashValue.value !== value) {
    dismissedSlashValue.value = null
  }

  // 只在输入开头检测 slash，避免普通文本中的 / 误触发技能菜单。
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
  if (shouldResetHighlight) {
    slashHighlightIndex.value = 0
  }
}

function getTextareaSelection() {
  return composerRef.value?.getSelection() ?? { start: inputValue.value.length, end: inputValue.value.length }
}

function extractMentionRange(value: string): (MentionRange & { query: string }) | null {
  const { start, end } = getTextareaSelection()
  if (start !== end) return null

  const beforeCursor = value.slice(0, start)
  // 允许在正文任意位置通过 @ 触发成员选择，不强制要求前面必须是空白。
  const match = beforeCursor.match(/@([^\s@]*)$/)
  if (!match) return null

  const query = match[1]
  const tokenStart = beforeCursor.length - query.length - 1

  return {
    start: tokenStart,
    end: start,
    rawToken: beforeCursor.slice(tokenStart),
    query,
  }
}

function updateMentionState(value: string) {
  if (props.disabled || showSlashMenu.value) {
    resetMentionState()
    return
  }

  const nextMention = extractMentionRange(value)

  if (dismissedMentionToken.value && dismissedMentionToken.value !== nextMention?.rawToken) {
    dismissedMentionToken.value = null
  }

  if (!nextMention) {
    resetMentionState()
    return
  }

  const shouldResetHighlight =
    !showMentionMenu.value ||
    mentionFilter.value !== nextMention.query ||
    mentionRange.value?.rawToken !== nextMention.rawToken

  mentionFilter.value = nextMention.query
  mentionRange.value = {
    start: nextMention.start,
    end: nextMention.end,
    rawToken: nextMention.rawToken,
  }

  if (dismissedMentionToken.value === nextMention.rawToken) {
    showMentionMenu.value = false
    return
  }

  showMentionMenu.value = true
  if (shouldResetHighlight) {
    mentionHighlightIndex.value = 0
  }
}

function updateInputMenus(value: string) {
  updateSlashState(value)

  if (showSlashMenu.value) {
    resetMentionState()
    return
  }

  updateMentionState(value)
}

function syncSelectedMentions(value: string) {
  selectedMentions.value = selectedMentions.value.filter((member) => value.includes(member.mentionText))
}

function deleteMentionAtCursor(): boolean {
  const { start, end } = getTextareaSelection()
  if (start !== end || start === 0) return false

  const mentionTexts = [...new Set(selectedMentions.value.map((member) => member.mentionText))].sort(
    (a, b) => b.length - a.length
  )

  for (const mentionText of mentionTexts) {
    let searchIndex = inputValue.value.indexOf(mentionText)

    while (searchIndex !== -1) {
      const mentionStart = searchIndex
      const mentionEnd = searchIndex + mentionText.length
      const deleteEnd = inputValue.value[mentionEnd] === ' ' ? mentionEnd + 1 : mentionEnd

      // 光标落在 mention 内部、末尾或其后面的补位空格时，统一整段删除。
      if (start > mentionStart && start <= deleteEnd) {
        suspendInputParsing.value = true
        inputValue.value = inputValue.value.slice(0, mentionStart) + inputValue.value.slice(deleteEnd)
        dismissedMentionToken.value = null

        nextTick(() => {
          syncTextareaHeight()
          focusTextarea()
          composerRef.value?.setSelectionRange(mentionStart, mentionStart)
          suspendInputParsing.value = false
          updateInputMenus(inputValue.value)
        })

        return true
      }

      searchIndex = inputValue.value.indexOf(mentionText, searchIndex + mentionText.length)
    }
  }

  return false
}

function clearActiveSkill() {
  skillStore.activateSkill(null)
  nextTick(focusTextarea)
}

function openSkillSelector() {
  if (props.disabled) return

  // 从外部快捷入口进入技能选择时，统一回到 slash 模式并清掉旧技能上下文。
  if (activeSkillId.value) {
    skillStore.activateSkill(null)
  }

  suspendInputParsing.value = true
  inputValue.value = '/'
  dismissedSlashValue.value = null

  nextTick(() => {
    syncTextareaHeight()
    focusTextarea()
    composerRef.value?.setSelectionRange(1, 1)
    suspendInputParsing.value = false
    updateInputMenus(inputValue.value)
  })
}

function fillInput(content: string) {
  if (props.disabled) return

  // 预设问题只回填到输入框，保留用户二次编辑的机会。
  suspendInputParsing.value = true
  inputValue.value = content
  dismissedSlashValue.value = null

  nextTick(() => {
    syncTextareaHeight()
    focusTextarea()
    const cursor = inputValue.value.length
    composerRef.value?.setSelectionRange(cursor, cursor)
    suspendInputParsing.value = false
    updateInputMenus(inputValue.value)
  })
}

function handleSelectMention(
  member: Pick<MentionCandidate, 'memberId' | 'platformId' | 'displayName' | 'insertName' | 'aliases'>
) {
  if (props.disabled || !mentionRange.value) return

  const prefix = inputValue.value.slice(0, mentionRange.value.start)
  const suffix = inputValue.value.slice(mentionRange.value.end)
  const mentionText = `@${member.insertName}`
  const nextValue = `${prefix}${mentionText} ${suffix}`

  selectedMentions.value = [
    ...selectedMentions.value.filter((item) => item.memberId !== member.memberId),
    {
      memberId: member.memberId,
      platformId: member.platformId,
      displayName: member.displayName,
      aliases: [...member.aliases],
      mentionText,
    },
  ]

  suspendInputParsing.value = true
  inputValue.value = nextValue
  dismissedMentionToken.value = null
  resetMentionState()

  nextTick(() => {
    const cursor = prefix.length + mentionText.length + 1
    syncTextareaHeight()
    focusTextarea()
    composerRef.value?.setSelectionRange(cursor, cursor)
    suspendInputParsing.value = false
    updateInputMenus(inputValue.value)
  })
}

function handleSubmit() {
  if (!canSubmit.value) return

  emit('send', {
    content: inputValue.value.trim(),
    mentionedMembers: [...selectedMentions.value],
  })
  inputValue.value = ''
  dismissedSlashValue.value = null
  dismissedMentionToken.value = null
  selectedMentions.value = []
  resetMentionState()

  // 技能为单次消息生效：发送后立即清空，下一次提问需重新选择。
  if (activeSkillId.value) {
    skillStore.activateSkill(null)
  }
}

function handleSelectSkill(skill: SkillSummary) {
  if (props.disabled) return

  skillStore.activateSkill(skill.id)
  emit('skillActivated', skill)

  // slash 选择技能只改变当前上下文，不应替用户生成一条消息。
  inputValue.value = ''
  dismissedSlashValue.value = null
  resetSlashState()

  nextTick(() => {
    focusTextarea()
  })
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

function moveMentionHighlight(step: 1 | -1) {
  if (!filteredMentionCandidates.value.length) return

  const total = filteredMentionCandidates.value.length
  mentionHighlightIndex.value = (mentionHighlightIndex.value + step + total) % total
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Backspace' && inputValue.value.length === 0 && activeSkillId.value) {
    event.preventDefault()
    clearActiveSkill()
    return
  }

  if (event.key === 'Backspace' && deleteMentionAtCursor()) {
    event.preventDefault()
    return
  }

  if (showMentionMenu.value) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveMentionHighlight(1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveMentionHighlight(-1)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      dismissMentionMenu()
      return
    }

    if ((event.key === 'Enter' && !event.shiftKey && !isComposing.value) || event.key === 'Tab') {
      event.preventDefault()
      const member = filteredMentionCandidates.value[mentionHighlightIndex.value]
      if (member) {
        handleSelectMention(member)
      }
      return
    }
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
      if (skill) {
        handleSelectSkill(skill)
      }
      return
    }
  }

  if (event.key === 'Enter' && !event.shiftKey && !isComposing.value) {
    event.preventDefault()
    handleSubmit()
  }
}

function handleDocumentMouseDown(event: MouseEvent) {
  if ((!showSlashMenu.value && !showMentionMenu.value) || !rootRef.value) return

  const target = event.target
  if (target instanceof Node && !rootRef.value.contains(target)) {
    dismissSlashMenu()
    dismissMentionMenu()
  }
}

function handleCursorChange() {
  if (suspendInputParsing.value) return
  updateInputMenus(inputValue.value)
}

watch(
  () => props.chatType,
  (chatType) => {
    skillStore.setFilterContext(chatType)
  },
  { immediate: true }
)

watch(inputValue, async (value) => {
  syncSelectedMentions(value)
  if (!suspendInputParsing.value) {
    updateInputMenus(value)
  }
  await nextTick()
  syncTextareaHeight()
})

watch(
  filteredSkills,
  (skills) => {
    if (skills.length === 0) {
      slashHighlightIndex.value = 0
      return
    }

    if (slashHighlightIndex.value >= skills.length) {
      slashHighlightIndex.value = skills.length - 1
    }
  },
  { immediate: true }
)

watch(
  filteredMentionCandidates,
  (members) => {
    if (members.length === 0) {
      mentionHighlightIndex.value = 0
      return
    }

    if (mentionHighlightIndex.value >= members.length) {
      mentionHighlightIndex.value = members.length - 1
    }
  },
  { immediate: true }
)

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) {
      dismissSlashMenu()
      dismissMentionMenu()
    }
  }
)

watch(
  () => props.sessionId,
  () => {
    selectedMentions.value = []
    resetMentionState()
    loadMentionMembers()
  },
  { immediate: true }
)

onMounted(async () => {
  if (!isLoaded.value) {
    await skillStore.loadSkills()
  }

  await nextTick()
  syncTextareaHeight()
  document.addEventListener('mousedown', handleDocumentMouseDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleDocumentMouseDown)
})

defineExpose({
  fillInput,
  openSkillSelector,
})
</script>

<template>
  <div class="shrink-0 pt-2 pb-2">
    <div ref="rootRef" class="relative w-full max-w-4xl mx-auto">
      <SlashCommandMenu
        :visible="showSlashMenu"
        :skills="filteredSkills"
        :highlight-index="slashHighlightIndex"
        :active-skill-id="activeSkillId"
        @select="handleSelectSkill"
        @close="dismissSlashMenu"
        @manage="handleManageSkills"
        @highlight="slashHighlightIndex = $event"
      />

      <MemberMentionMenu
        :visible="showMentionMenu"
        :members="filteredMentionCandidates"
        :highlight-index="mentionHighlightIndex"
        :loading="isLoadingMentionMembers"
        @select="handleSelectMention"
        @close="dismissMentionMenu"
        @highlight="mentionHighlightIndex = $event"
      />

      <AIChatComposer
        ref="composerRef"
        v-model="inputValue"
        :disabled="props.disabled"
        :status="props.status"
        :placeholder="inputPlaceholder"
        :send-button-title="sendButtonTitle"
        :active-skill-name="activeSkill?.name"
        @submit="handleSubmit"
        @stop="emit('stop')"
        @keydown="handleKeydown"
        @cursor-change="handleCursorChange"
        @composition-start="isComposing = true"
        @composition-end="isComposing = false"
      />
    </div>
  </div>
</template>
