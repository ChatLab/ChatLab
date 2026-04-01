<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MemberWithStats } from '@/types/analysis'
import { useSessionStore } from '@/stores/session'

const { t } = useI18n()
const sessionStore = useSessionStore()

// Props
const props = defineProps<{
  sessionId: string
  members: MemberWithStats[]
  isLoading?: boolean
  chatType?: 'group' | 'private'
}>()

// Owner 配置相关
const isSavingOwner = ref(false)

// 获取成员显示名称
function getDisplayName(member: MemberWithStats): string {
  return member.groupNickname || member.accountName || member.platformId
}

// 当前 owner 的成员信息
const currentOwner = computed(() => {
  const ownerId = sessionStore.currentSession?.ownerId
  if (!ownerId) return null
  return props.members.find((m) => m.platformId === ownerId) || null
})

// 特殊值，用于表示"未设置"
const UNSET_VALUE = '__UNSET__'

// 成员选项（用于下拉选择）
const memberOptions = computed(() => {
  return [
    { label: t('members.ownerSelector.unset'), value: UNSET_VALUE },
    ...props.members
      // 过滤掉 platformId 为空的成员（USelect 不允许空字符串作为 value）
      .filter((m) => m.platformId && m.platformId.trim() !== '')
      .map((m) => ({
        label: `${getDisplayName(m)} (${m.platformId})`,
        value: m.platformId,
      })),
  ]
})

// 当前选中的 owner 值（用于 USelect）
const selectedOwnerValue = computed(() => {
  return sessionStore.currentSession?.ownerId || UNSET_VALUE
})

// 提示文字
const hintText = computed(() => {
  if (currentOwner.value) {
    return t('members.ownerSelector.currentOwner', { name: getDisplayName(currentOwner.value) })
  }
  return t('members.ownerSelector.hint')
})

// 更新 owner
async function updateOwner(value: string) {
  const platformId = value === UNSET_VALUE ? null : value
  isSavingOwner.value = true
  try {
    await sessionStore.updateSessionOwnerId(props.sessionId, platformId)
  } catch (error) {
    console.error('更新所有者失败:', error)
  } finally {
    isSavingOwner.value = false
  }
}
</script>

<template>
  <div class="w-150 rounded-lg border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900">
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <div
          class="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-br"
          :class="chatType === 'group' ? 'from-pink-400 to-pink-600' : 'from-purple-400 to-purple-600'"
        >
          <UIcon name="i-heroicons-user" class="h-4 w-4 text-white" />
        </div>
        <div>
          <h3 class="text-sm font-medium text-gray-900 dark:text-white">{{ t('members.ownerSelector.title') }}</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ hintText }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <USelect
          :model-value="selectedOwnerValue"
          :items="memberOptions"
          :placeholder="t('members.ownerSelector.selectMember')"
          class="w-48"
          :disabled="isSavingOwner || isLoading"
          @update:model-value="updateOwner"
        />
        <UIcon
          v-if="isSavingOwner"
          name="i-heroicons-arrow-path"
          class="h-4 w-4 animate-spin"
          :class="chatType === 'group' ? 'text-pink-500' : 'text-purple-500'"
        />
      </div>
    </div>
  </div>
</template>
