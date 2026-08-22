<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import UEditor from '@nuxt/ui/components/Editor.vue'
import AIChatMentionMenu from './AIChatMentionMenu.vue'
import { resolveMentionMenuKeyboardAction } from './mention-menu-keyboard'

interface EditorNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  content?: EditorNode[]
}

interface MentionMenuItem {
  id: string
  label: string
  avatar?: string | null
  searchText?: string
}

type MentionTab = 'contact' | 'group'

interface EditorInstance {
  editor?: {
    commands: {
      focus: (position?: 'start' | 'end') => boolean
      insertContent: (content: string) => boolean
    }
    setEditable: (editable: boolean, emitUpdate?: boolean) => void
  }
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    disabled?: boolean
    status?: 'ready' | 'submitted' | 'streaming' | 'error'
    placeholder: string
    sendButtonTitle: string
    activeSkillName?: string | null
    mentionItems?: MentionMenuItem[]
    mentionSearchTerm?: string
    asyncMentionSearch?: boolean
    showMentionTabs?: boolean
    mentionTab?: MentionTab
    contactTabLabel?: string
    groupTabLabel?: string
    embedded?: boolean
  }>(),
  {
    disabled: false,
    status: 'ready',
    activeSkillName: null,
    mentionItems: () => [],
    mentionSearchTerm: '',
    asyncMentionSearch: false,
    showMentionTabs: false,
    mentionTab: 'contact',
    contactTabLabel: '',
    groupTabLabel: '',
    embedded: false,
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:mentionSearchTerm': [value: string]
  'update:mentionTab': [value: MentionTab]
  mentionsChange: [ids: string[]]
  submit: []
  stop: []
  keydown: [event: KeyboardEvent]
  compositionStart: []
  compositionEnd: []
}>()

const editorRef = ref<EditorInstance | null>(null)
const editorDocument = ref<EditorNode>(createTextDocument(props.modelValue))
let mentionNodeCount = 0
let mentionMenuHost: HTMLElement | null = null
let hasMentionMenuKeyboardSelection = false
const canSubmit = computed(() => props.modelValue.trim().length > 0 && !props.disabled)

const editorProps = {
  handleKeyDown: (_view: unknown, event: KeyboardEvent) => {
    emit('keydown', event)
    return event.defaultPrevented
  },
  handleDOMEvents: {
    compositionstart: () => {
      emit('compositionStart')
      return false
    },
    compositionend: () => {
      emit('compositionEnd')
      return false
    },
  },
}

const starterKit = {
  blockquote: false as const,
  bold: false as const,
  bulletList: false as const,
  code: false as const,
  codeBlock: false as const,
  heading: false as const,
  italic: false as const,
  link: false as const,
  listItem: false as const,
  orderedList: false as const,
  strike: false as const,
  underline: false as const,
}

const mentionOptions = {
  HTMLAttributes: {
    class: 'ai-chat-mention',
  },
  deleteTriggerWithBackspace: true,
}

function createTextDocument(value: string): EditorNode {
  const lines = value.split('\n')
  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : undefined,
    })),
  }
}

function getMentionText(node: EditorNode): string {
  const id = typeof node.attrs?.id === 'string' ? node.attrs.id : ''
  const label = typeof node.attrs?.label === 'string' ? node.attrs.label : id
  return `@${label}`
}

function nodeToText(node: EditorNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'mention') return getMentionText(node)
  if (node.type === 'hardBreak') return '\n'

  const content = node.content ?? []
  const separator = node.type === 'doc' ? '\n' : ''
  return content.map(nodeToText).join(separator)
}

function collectMentionIds(node: EditorNode, result: string[] = []): string[] {
  if (node.type === 'mention' && typeof node.attrs?.id === 'string') {
    result.push(node.attrs.id)
  }
  node.content?.forEach((child) => collectMentionIds(child, result))
  return result
}

function handleDocumentUpdate(document: EditorNode) {
  editorDocument.value = document
  const mentionIds = collectMentionIds(document)
  const insertedMention = mentionIds.length > mentionNodeCount
  mentionNodeCount = mentionIds.length
  emit('update:modelValue', nodeToText(document))
  emit('mentionsChange', [...new Set(mentionIds)])

  if (insertedMention) {
    nextTick(() => editorRef.value?.editor?.commands.insertContent(' '))
  }
}

function focus(position: 'start' | 'end' = 'end') {
  editorRef.value?.editor?.commands.focus(position)
}

function setText(value: string) {
  mentionNodeCount = 0
  editorDocument.value = createTextDocument(value)
}

function clear() {
  setText('')
}

function syncHeight() {
  // The contenteditable surface grows through CSS and scrolls after reaching its max height.
}

function preventHoverSelection(event: Event) {
  if (event.target instanceof Element && event.target.closest('[role="option"]')) {
    event.stopPropagation()
  }
}

function activateMentionMenuKeyboardSelection() {
  hasMentionMenuKeyboardSelection = true
  mentionMenuHost?.classList.add('has-keyboard-selection')
}

function handleMentionMenuKeydown(event: KeyboardEvent) {
  if (!mentionMenuHost?.firstElementChild) return

  const action = resolveMentionMenuKeyboardAction({
    key: event.key,
    isComposing: event.isComposing,
    hasKeyboardSelection: hasMentionMenuKeyboardSelection,
  })
  if (action === 'activate' || action === 'activate-and-block') {
    activateMentionMenuKeyboardSelection()
  }
  if (action === 'block' || action === 'activate-and-block') {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}

function getMentionMenuContainer() {
  hasMentionMenuKeyboardSelection = false
  mentionMenuHost?.classList.remove('has-keyboard-selection')

  if (!mentionMenuHost) {
    mentionMenuHost = document.createElement('div')
    mentionMenuHost.className = 'ai-chat-mention-menu-host'
    mentionMenuHost.addEventListener('mouseenter', preventHoverSelection, true)
    document.body.appendChild(mentionMenuHost)
  }
  return mentionMenuHost
}

onMounted(() => {
  document.addEventListener('keydown', handleMentionMenuKeydown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleMentionMenuKeydown, true)
  mentionMenuHost?.remove()
  mentionMenuHost = null
})

watch(
  () => props.modelValue,
  (value) => {
    if (nodeToText(editorDocument.value) !== value) {
      setText(value)
    }
  }
)

watch(
  () => props.disabled,
  (disabled) => {
    // Nuxt UI Editor 4.9 does not forward later editable prop changes to the existing Tiptap instance.
    editorRef.value?.editor?.setEditable(!disabled, false)
  }
)

defineExpose({ focus, setText, clear, syncHeight })
</script>

<template>
  <div
    class="flex flex-col overflow-hidden transition-all"
    :class="[
      embedded
        ? 'bg-transparent'
        : 'rounded-2xl bg-white shadow-[0_2px_14px_rgba(0,0,0,0.04)] ring-1 ring-gray-200/60 dark:bg-page-dark dark:ring-white/5',
      !embedded && disabled ? 'bg-gray-50/50 dark:bg-page-dark/50' : '',
      !embedded && !disabled
        ? 'focus-within:ring-primary-500/40 focus-within:shadow-[0_4px_20px_rgba(0,0,0,0.08)] dark:focus-within:ring-primary-500/40'
        : '',
    ]"
  >
    <div class="px-4 pt-2.5 pb-2.5" :class="{ relative: !embedded }">
      <div class="flex items-start gap-2" :class="{ 'pr-10': !embedded }">
        <div
          v-if="activeSkillName"
          class="inline-flex max-w-[180px] shrink-0 items-center rounded-md bg-primary-50 px-2 text-sm leading-6 font-medium text-primary-700 dark:bg-primary-500/10 dark:text-primary-400"
        >
          <span class="truncate">/{{ activeSkillName }}</span>
        </div>

        <UEditor
          ref="editorRef"
          :model-value="editorDocument"
          content-type="json"
          class="ai-chat-editor min-w-0 flex-1"
          :editable="!disabled"
          :placeholder="placeholder"
          :starter-kit="starterKit"
          :mention="mentionOptions"
          :image="false"
          :editor-props="editorProps"
          @update:model-value="handleDocumentUpdate"
        >
          <template #default="{ editor }">
            <AIChatMentionMenu
              :search-term="props.mentionSearchTerm"
              :editor="editor"
              :items="mentionItems"
              :filter-fields="['label', 'searchText']"
              :ignore-filter="asyncMentionSearch"
              :limit="100"
              :append-to="getMentionMenuContainer"
              :show-tabs="showMentionTabs"
              :active-tab="mentionTab"
              :contact-tab-label="contactTabLabel"
              :group-tab-label="groupTabLabel"
              @update:search-term="emit('update:mentionSearchTerm', $event)"
              @update:active-tab="emit('update:mentionTab', $event)"
            />
          </template>
        </UEditor>
      </div>

      <button
        v-if="status === 'streaming'"
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
        @click="emit('submit')"
      >
        <UIcon name="i-heroicons-arrow-up-20-solid" class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.ai-chat-editor :deep(.tiptap) {
  min-height: 48px;
  max-height: 192px;
  overflow-y: auto;
  border: 0;
  padding: 0;
  color: var(--color-gray-900);
  font-size: 0.875rem;
  line-height: 1.5rem;
  outline: none;
}

.ai-chat-editor :deep(.tiptap p) {
  margin: 0;
}

.ai-chat-editor :deep(.tiptap .ai-chat-mention) {
  display: inline-flex;
  align-items: center;
  border-radius: 0.375rem;
  background: color-mix(in srgb, var(--color-primary-500) 12%, transparent);
  padding: 0 0.25rem;
  color: var(--color-primary-700);
  line-height: 1.25rem;
  white-space: nowrap;
}

.ai-chat-editor :deep(.tiptap p.is-editor-empty:first-child::before) {
  color: var(--color-gray-400);
}

.dark .ai-chat-editor :deep(.tiptap) {
  color: var(--color-gray-100);
}

.dark .ai-chat-editor :deep(.tiptap .ai-chat-mention) {
  background: color-mix(in srgb, var(--color-primary-500) 16%, transparent);
  color: var(--color-primary-400);
}

.dark .ai-chat-editor :deep(.tiptap p.is-editor-empty:first-child::before) {
  color: var(--color-gray-500);
}
</style>

<style>
.ai-chat-mention-menu-host > div {
  width: 16rem !important;
  max-width: calc(100vw - 2rem);
  opacity: 0;
  visibility: hidden;
}

.ai-chat-mention-menu-host > div[style*='transform: translate'] {
  visibility: visible;
  animation: ai-chat-mention-menu-reveal 0s 40ms forwards;
}

@keyframes ai-chat-mention-menu-reveal {
  to {
    opacity: 1;
  }
}

.ai-chat-mention-menu-host [role='listbox'] {
  box-sizing: border-box;
  width: 16rem;
  min-width: 0;
  max-width: calc(100vw - 2rem);
  max-height: 16rem;
  padding: 0.25rem;
  overflow: hidden;
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
  border-radius: 0.75rem;
  box-shadow: 0 12px 32px rgb(0 0 0 / 16%);
}

.ai-chat-mention-menu-host [role='presentation'] {
  overflow-y: auto;
  scrollbar-width: thin;
}

.ai-chat-mention-menu-host [role='group'] {
  padding: 0;
}

.ai-chat-mention-menu-host [role='option'] {
  min-height: 2.25rem;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.5rem;
}

.ai-chat-mention-menu-host [role='option']::before {
  inset: 0;
  border-radius: 0.5rem;
}

.ai-chat-mention-menu-host.has-keyboard-selection [role='option'][data-highlighted]::before {
  background: color-mix(in srgb, var(--ui-primary) 10%, transparent);
}

.ai-chat-mention-menu-host [role='option']:hover::before {
  background: color-mix(in srgb, var(--ui-primary) 6%, transparent);
}

.ai-chat-mention-tabs {
  padding: 0.25rem 0.25rem 0.375rem;
  background: var(--ui-bg);
}

.ai-chat-mention-tabs__inner {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.125rem;
  padding: 0.125rem;
  background: var(--ui-bg-muted);
  border-radius: 0.5rem;
}

.ai-chat-mention-tabs__button {
  height: 1.625rem;
  padding: 0 0.5rem;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
  line-height: 1rem;
  cursor: pointer;
  border-radius: 0.375rem;
}

.ai-chat-mention-tabs__button:hover {
  color: var(--ui-text-highlighted);
}

.ai-chat-mention-tabs__button.is-active {
  color: var(--ui-text-highlighted);
  background: var(--ui-bg);
  box-shadow: 0 1px 2px rgb(0 0 0 / 8%);
}
</style>
