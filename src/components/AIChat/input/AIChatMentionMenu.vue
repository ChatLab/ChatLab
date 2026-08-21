<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, toRef } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { useEditorMenu } from '@nuxt/ui/composables'
import LazyAvatar from '@/components/common/avatar/LazyAvatar.vue'

export interface AIChatMentionMenuItem {
  id: string
  label: string
  avatar?: string | null
  searchText?: string
}

type MentionTab = 'contact' | 'group'

const props = withDefaults(
  defineProps<{
    editor?: Editor
    items?: AIChatMentionMenuItem[]
    searchTerm?: string
    filterFields?: string[]
    ignoreFilter?: boolean
    limit?: number
    appendTo?: HTMLElement | (() => HTMLElement)
    showTabs?: boolean
    activeTab?: MentionTab
    contactTabLabel?: string
    groupTabLabel?: string
  }>(),
  {
    items: () => [],
    searchTerm: '',
    filterFields: () => ['label'],
    ignoreFilter: false,
    limit: 42,
    showTabs: false,
    activeTab: 'contact',
    contactTabLabel: '',
    groupTabLabel: '',
  }
)

const emit = defineEmits<{
  'update:searchTerm': [value: string]
  'update:activeTab': [value: MentionTab]
}>()

const searchTerm = computed({
  get: () => props.searchTerm,
  set: (value) => emit('update:searchTerm', value),
})
const tabItem: AIChatMentionMenuItem & { type: 'label' } = {
  id: '__mention-tabs__',
  label: '',
  type: 'label',
}
const menuItems = computed(() => (props.showTabs ? [tabItem, ...props.items] : props.items))

const menuUi = computed(() => ({
  content: () => 'flex flex-col',
  viewport: () => 'relative flex-1 overflow-y-auto',
  group: () => 'isolate',
  label: () => 'ai-chat-mention-tabs sticky top-0 z-10',
  separator: () => 'h-px bg-border',
  item: () =>
    'group relative flex w-full items-center select-none outline-none before:absolute before:z-[-1] data-disabled:cursor-not-allowed data-disabled:opacity-75',
}))

let menu: ReturnType<typeof useEditorMenu<AIChatMentionMenuItem>> | null = null

function renderTabs() {
  return h('div', { class: 'ai-chat-mention-tabs__inner' }, [
    h(
      'button',
      {
        type: 'button',
        class: ['ai-chat-mention-tabs__button', props.activeTab === 'contact' && 'is-active'],
        'aria-pressed': props.activeTab === 'contact',
        onMousedown: (event: MouseEvent) => event.preventDefault(),
        onClick: () => emit('update:activeTab', 'contact'),
      },
      props.contactTabLabel
    ),
    h(
      'button',
      {
        type: 'button',
        class: ['ai-chat-mention-tabs__button', props.activeTab === 'group' && 'is-active'],
        'aria-pressed': props.activeTab === 'group',
        onMousedown: (event: MouseEvent) => event.preventDefault(),
        onClick: () => emit('update:activeTab', 'group'),
      },
      props.groupTabLabel
    ),
  ])
}

onMounted(async () => {
  await nextTick()
  if (!props.editor || props.editor.isDestroyed) return

  menu = useEditorMenu<AIChatMentionMenuItem>({
    editor: props.editor,
    char: '@',
    pluginKey: 'mentionMenu',
    items: toRef(() => menuItems.value),
    filterFields: props.filterFields,
    ignoreFilter: props.ignoreFilter,
    limit: props.limit,
    options: { placement: 'top-start' },
    appendTo: props.appendTo,
    searchTerm,
    ui: menuUi,
    onSelect: (editor, range, item) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mention',
          attrs: {
            id: item.id,
            label: item.label,
            mentionSuggestionChar: '@',
          },
        })
        .run()
    },
    renderItem: (item) => {
      if ('type' in item && item.type === 'label') return renderTabs()

      const leading = h(LazyAvatar, {
        src: item.avatar,
        alt: item.label,
        text: item.label.slice(0, 1),
        rootClass: 'h-5 w-5 shrink-0',
        imageClass: 'h-5 w-5 rounded-md object-cover',
        fallbackClass:
          'flex h-5 w-5 items-center justify-center rounded-md bg-gray-100 text-[9px] text-gray-500 dark:bg-gray-800 dark:text-gray-400',
        rootMargin: '0px',
      })

      return [leading, h('span', { class: 'min-w-0 flex-1 truncate text-sm leading-[18px]' }, item.label)]
    },
  })
  props.editor.registerPlugin(menu.plugin)
})

onBeforeUnmount(() => {
  menu?.destroy()
  menu = null
  if (props.editor && !props.editor.isDestroyed) {
    props.editor.unregisterPlugin('mentionMenu')
  }
})
</script>

<template>
  <div />
</template>
