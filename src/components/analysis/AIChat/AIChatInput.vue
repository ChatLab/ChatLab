<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import SlashCommandMenu from './SlashCommandMenu.vue'
import { useSkillStore, type SkillSummary } from '@/stores/skill'

const { t } = useI18n()

const props = defineProps<{
  disabled?: boolean
  status?: 'ready' | 'submitted' | 'streaming' | 'error'
  chatType: 'group' | 'private'
}>()

const emit = defineEmits<{
  send: [content: string]
  stop: []
  manageSkills: []
  skillActivated: [skill: SkillSummary]
}>()

const skillStore = useSkillStore()
const { compatibleSkills, activeSkill, activeSkillId, isLoaded } = storeToRefs(skillStore)

const rootRef = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const inputValue = ref('')
const showSlashMenu = ref(false)
const slashFilter = ref('')
const highlightIndex = ref(0)
const isComposing = ref(false)
const dismissedSlashValue = ref<string | null>(null)

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

const filteredSkills = computed(() => {
  const keyword = slashFilter.value.trim().toLocaleLowerCase()
  if (!keyword) return compatibleSkills.value

  return compatibleSkills.value.filter((skill) => {
    const haystack = [skill.name, skill.description, skill.tags.join(' ')].join(' ').toLocaleLowerCase()
    return haystack.includes(keyword)
  })
})

function syncTextareaHeight() {
  if (!textareaRef.value) return

  const textarea = textareaRef.value
  textarea.style.height = 'auto'

  // 默认展示两行，最多扩展到约 8 行，避免输入框过高挤压消息区。
  const maxHeight = 192
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight)
  textarea.style.height = `${nextHeight}px`
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

function focusTextarea() {
  textareaRef.value?.focus()
}

function resetSlashState() {
  showSlashMenu.value = false
  slashFilter.value = ''
  highlightIndex.value = 0
}

function dismissSlashMenu() {
  if (/^\s*\/([^\n]*)$/.test(inputValue.value)) {
    dismissedSlashValue.value = inputValue.value
  }
  resetSlashState()
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

  slashFilter.value = match[1]

  if (dismissedSlashValue.value === value) {
    showSlashMenu.value = false
    return
  }

  showSlashMenu.value = true
  highlightIndex.value = 0
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

  inputValue.value = '/'
  dismissedSlashValue.value = null
  updateSlashState(inputValue.value)

  nextTick(() => {
    syncTextareaHeight()
    focusTextarea()
    textareaRef.value?.setSelectionRange(1, 1)
  })
}

function fillInput(content: string) {
  if (props.disabled) return

  // 预设问题只回填到输入框，保留用户二次编辑的机会。
  inputValue.value = content
  dismissedSlashValue.value = null

  nextTick(() => {
    syncTextareaHeight()
    focusTextarea()
    const cursor = inputValue.value.length
    textareaRef.value?.setSelectionRange(cursor, cursor)
  })
}

function handleSubmit() {
  if (!canSubmit.value) return

  emit('send', inputValue.value.trim())
  inputValue.value = ''
  dismissedSlashValue.value = null

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

function moveHighlight(step: 1 | -1) {
  if (!filteredSkills.value.length) return

  const total = filteredSkills.value.length
  highlightIndex.value = (highlightIndex.value + step + total) % total
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Backspace' && inputValue.value.length === 0 && activeSkillId.value) {
    event.preventDefault()
    clearActiveSkill()
    return
  }

  if (showSlashMenu.value) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveHighlight(1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveHighlight(-1)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      dismissSlashMenu()
      return
    }

    if (event.key === 'Enter' && !event.shiftKey && !isComposing.value) {
      event.preventDefault()
      const skill = filteredSkills.value[highlightIndex.value]
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
  if (!showSlashMenu.value || !rootRef.value) return

  const target = event.target
  if (target instanceof Node && !rootRef.value.contains(target)) {
    dismissSlashMenu()
  }
}

watch(
  () => props.chatType,
  (chatType) => {
    skillStore.setFilterContext(chatType)
  },
  { immediate: true }
)

watch(inputValue, async (value) => {
  updateSlashState(value)
  await nextTick()
  syncTextareaHeight()
})

watch(
  filteredSkills,
  (skills) => {
    if (skills.length === 0) {
      highlightIndex.value = 0
      return
    }

    if (highlightIndex.value >= skills.length) {
      highlightIndex.value = skills.length - 1
    }
  },
  { immediate: true }
)

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) {
      dismissSlashMenu()
    }
  }
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
        :highlight-index="highlightIndex"
        :active-skill-id="activeSkillId"
        @select="handleSelectSkill"
        @close="dismissSlashMenu"
        @manage="handleManageSkills"
        @highlight="highlightIndex = $event"
      />

      <div
        class="flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_2px_14px_rgba(0,0,0,0.04)] ring-1 ring-gray-200 transition-all dark:bg-gray-900 dark:ring-gray-800"
        :class="
          props.disabled
            ? 'bg-gray-50/50 dark:bg-gray-900/50'
            : 'focus-within:ring-primary-500/50 focus-within:shadow-[0_4px_20px_rgba(0,0,0,0.08)] dark:focus-within:ring-primary-500/50'
        "
      >
        <div class="relative px-4 pt-2.5 pb-2.5">
          <!-- 技能标签与输入框同排显示，形成“视觉内联”的 slash command 效果。 -->
          <div class="flex items-start gap-2 pr-10">
            <div
              v-if="activeSkill"
              class="inline-flex max-w-[180px] shrink-0 items-center rounded-md bg-primary-50 px-2 text-sm leading-6 font-medium text-primary-700 dark:bg-primary-500/10 dark:text-primary-400"
            >
              <span class="truncate">/{{ activeSkill.name }}</span>
            </div>

            <textarea
              ref="textareaRef"
              v-model="inputValue"
              rows="2"
              class="min-h-[48px] min-w-0 flex-1 resize-none border-0 bg-transparent px-0 py-0 text-sm leading-6 text-gray-900 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed disabled:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:text-gray-500"
              :disabled="props.disabled"
              :placeholder="inputPlaceholder"
              @keydown="handleKeydown"
              @compositionstart="isComposing = true"
              @compositionend="isComposing = false"
            />
          </div>

          <button
            v-if="props.status === 'streaming'"
            type="button"
            class="absolute right-3 bottom-2 flex h-7 w-7 items-center justify-center rounded-full bg-primary-500 text-white shadow-sm transition-colors hover:bg-primary-600"
            @click="emit('stop')"
          >
            <UIcon name="i-heroicons-stop-16-solid" class="h-3.5 w-3.5" />
          </button>

          <button
            v-else
            type="button"
            class="absolute right-3 bottom-2 flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200"
            :class="
              canSubmit
                ? 'bg-primary-500 text-white hover:bg-primary-600 shadow-sm'
                : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
            "
            :disabled="!canSubmit"
            :title="sendButtonTitle"
            @click="handleSubmit"
          >
            <UIcon name="i-heroicons-arrow-up-20-solid" class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
