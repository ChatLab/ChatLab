<script setup lang="ts">
/**
 * "我是谁"入口卡片（成员管理页）
 *
 * 展示当前 owner 状态，点击打开 OwnerPromptModal 统一选择入口。
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MemberWithStats } from '@/types/analysis'
import { useSessionStore } from '@/stores/session'
import { ThemeCard } from '@/components/UI'
import OwnerPromptModal from './OwnerPromptModal.vue'

const { t } = useI18n()
const sessionStore = useSessionStore()

const props = defineProps<{
  sessionId: string
  members: MemberWithStats[]
  chatType?: 'group' | 'private'
}>()

const showModal = ref(false)

function getDisplayName(member: MemberWithStats): string {
  return member.groupNickname || member.accountName || member.platformId
}

const currentOwner = computed(() => {
  const ownerId = sessionStore.currentSession?.ownerId
  if (!ownerId) return null
  return props.members.find((m) => m.platformId === ownerId) || null
})

const ownerDisplayName = computed(() => {
  if (currentOwner.value) return getDisplayName(currentOwner.value)
  // owner 已设置但成员列表中找不到（如成员被合并/删除）时退回显示 platformId
  return sessionStore.currentSession?.ownerId ?? ''
})
</script>

<template>
  <ThemeCard class="w-150 p-3">
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <div
          class="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-br"
          :class="chatType === 'group' ? 'from-pink-400 to-pink-600' : 'from-purple-400 to-purple-600'"
        >
          <UIcon name="i-heroicons-user" class="h-4 w-4 text-white" />
        </div>
        <div>
          <h3 class="text-sm font-medium text-gray-900 dark:text-white">
            {{
              ownerDisplayName
                ? t('members.ownerPrompt.currentOwner', { name: ownerDisplayName })
                : t('members.ownerPrompt.choose')
            }}
          </h3>
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('members.ownerPrompt.helper') }}</p>
        </div>
      </div>
      <UButton size="sm" :variant="ownerDisplayName ? 'outline' : 'solid'" color="primary" @click="showModal = true">
        {{ ownerDisplayName ? t('members.ownerPrompt.change') : t('members.ownerPrompt.choose') }}
      </UButton>
    </div>

    <OwnerPromptModal v-model="showModal" :session-id="sessionId" :chat-type="chatType" />
  </ThemeCard>
</template>
