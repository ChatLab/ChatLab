<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

interface MentionCandidate {
  memberId: number
  platformId: string
  displayName: string
  insertName: string
  aliases: string[]
  subtitle: string
}

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
  members: MentionCandidate[]
  highlightIndex: number
  loading?: boolean
}>()

const emit = defineEmits<{
  select: [member: MentionCandidate]
  close: []
  highlight: [index: number]
}>()

const listRef = ref<HTMLElement | null>(null)

watch(
  () => [props.visible, props.highlightIndex, props.members.length] as const,
  async ([visible, highlightIndex]) => {
    if (!visible || !listRef.value) return

    await nextTick()
    const items = listRef.value.querySelectorAll<HTMLElement>('[data-mention-item]')
    const target = items[highlightIndex]
    // 键盘切换高亮时，保持当前项始终处于可见区域内。
    target?.scrollIntoView({ block: 'nearest' })
  }
)
</script>

<template>
  <Transition name="mention-menu">
    <div v-if="visible" class="absolute bottom-full left-0 z-20 mb-1.5 w-[240px] max-w-[calc(100vw-2rem)]">
      <div
        class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-gray-900/10 dark:border-gray-700 dark:bg-gray-900"
      >
        <div class="flex items-center justify-between border-b border-gray-100 px-2.5 py-1.5 dark:border-gray-800">
          <div class="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            <span>{{ t('ai.chat.input.mentionHint') }}</span>
          </div>
          <button
            type="button"
            class="rounded-md p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            :title="t('common.close')"
            @click="emit('close')"
          >
            <UIcon name="i-heroicons-x-mark" class="h-3.5 w-3.5" />
          </button>
        </div>

        <div v-if="props.loading" class="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
          {{ t('common.loading') }}
        </div>

        <div v-else-if="props.members.length > 0" ref="listRef" class="max-h-72 overflow-y-auto p-1.5">
          <button
            v-for="(member, index) in props.members"
            :key="`${member.memberId}-${member.insertName}`"
            type="button"
            data-mention-item
            class="flex w-full items-start justify-between gap-1.5 rounded-lg px-2.5 py-1.5 text-left transition-colors"
            :class="
              index === props.highlightIndex
                ? 'bg-primary-50 text-gray-900 dark:bg-primary-950/30 dark:text-gray-100'
                : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800/80'
            "
            @mouseenter="emit('highlight', index)"
            @click="emit('select', member)"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="truncate text-xs font-medium">@{{ member.insertName }}</span>
              </div>
              <p class="mt-0.5 line-clamp-2 text-[11px] leading-4 text-gray-500 dark:text-gray-400">
                {{ member.subtitle }}
              </p>
            </div>
          </button>
        </div>

        <div v-else class="px-3 py-4 text-center">
          <p class="text-sm font-medium text-gray-700 dark:text-gray-200">
            {{ t('ai.chat.input.mentionEmpty') }}
          </p>
          <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            {{ t('ai.chat.input.mentionEmptyHint') }}
          </p>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.mention-menu-enter-active,
.mention-menu-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.mention-menu-enter-from,
.mention-menu-leave-to {
  transform: translateY(8px);
  opacity: 0;
}
</style>
