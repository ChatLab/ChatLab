<script setup lang="ts">
/**
 * "我是谁"选择弹窗
 *
 * 两种使用方式：
 * 1. 会话页挂载（autoCheck）：会话无 owner 时先尝试用平台 owner profile 自动补全，
 *    补全失败且未被"本会话不再提醒"时自动弹出
 * 2. 成员管理入口手动打开（v-model）
 *
 * 保存时会更新平台级 owner profile，并自动应用到同平台其他未设置 owner 的会话。
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MemberWithStats } from '@/types/analysis'
import { useSessionStore } from '@/stores/session'
import { useDataService } from '@/services'
import { useToast } from '@/composables/useToast'

const props = withDefaults(
  defineProps<{
    sessionId: string
    /** 弹窗打开状态（v-model） */
    modelValue?: boolean
    chatType?: 'group' | 'private'
    /** 挂载时自动检测：无 owner 时尝试自动补全，失败且未忽略则弹出 */
    autoCheck?: boolean
  }>(),
  {
    modelValue: false,
    chatType: 'group',
    autoCheck: false,
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved', ownerId: string): void
  (e: 'cleared'): void
}>()

const { t } = useI18n()
const toast = useToast()
const sessionStore = useSessionStore()

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const members = ref<MemberWithStats[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const isDismissing = ref(false)
const searchQuery = ref('')
const selectedPlatformId = ref<string | null>(null)

const currentOwnerId = computed(() => sessionStore.currentSession?.ownerId ?? null)

function getDisplayName(member: MemberWithStats): string {
  return member.groupNickname || member.accountName || member.platformId
}

const filteredMembers = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const valid = members.value.filter((m) => m.platformId && m.platformId.trim() !== '')
  if (!query) return valid
  return valid.filter((m) =>
    [m.platformId, m.accountName ?? '', m.groupNickname ?? '', ...m.aliases].some((name) =>
      name.toLowerCase().includes(query)
    )
  )
})

async function loadMembers() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    members.value = await useDataService().getMembers(props.sessionId)
  } catch (error) {
    console.error('加载成员列表失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 自动检测：尝试自动补全 owner，失败且未忽略时弹出
async function checkAndAutoOpen() {
  if (!props.sessionId || !props.autoCheck) return
  if (currentOwnerId.value) return
  try {
    const result = await sessionStore.tryApplyOwnerProfile(props.sessionId)
    if (result.applied || result.reason === 'already_set' || result.reason === 'missing_session') return
    if (result.dismissed) return
    isOpen.value = true
  } catch (error) {
    console.error('检查会话 owner 失败:', error)
  }
}

async function save() {
  if (!selectedPlatformId.value || !props.sessionId) return
  isSaving.value = true
  try {
    const result = await sessionStore.setOwnerAndApplyProfile(props.sessionId, selectedPlatformId.value)
    if (result.updatedSessionIds.length > 0) {
      toast.success(t('members.ownerPrompt.saved'), {
        description: t('members.ownerPrompt.appliedToOthers', { count: result.updatedSessionIds.length }),
      })
    } else {
      toast.success(t('members.ownerPrompt.saved'))
    }
    emit('saved', result.ownerId)
    isOpen.value = false
  } catch (error) {
    console.error('设置会话 owner 失败:', error)
    toast.fail(t('members.ownerPrompt.saveFailed'))
  } finally {
    isSaving.value = false
  }
}

// 清除当前会话 owner（不影响平台 owner profile）
async function clearOwner() {
  if (!props.sessionId || !currentOwnerId.value) return
  isSaving.value = true
  try {
    const success = await sessionStore.updateSessionOwnerId(props.sessionId, null)
    if (success) {
      selectedPlatformId.value = null
      emit('cleared')
      isOpen.value = false
    }
  } catch (error) {
    console.error('清除会话 owner 失败:', error)
  } finally {
    isSaving.value = false
  }
}

async function dismissForever() {
  if (!props.sessionId) return
  isDismissing.value = true
  try {
    await sessionStore.dismissOwnerPrompt(props.sessionId)
    isOpen.value = false
  } catch (error) {
    console.error('忽略 owner 提醒失败:', error)
  } finally {
    isDismissing.value = false
  }
}

function later() {
  isOpen.value = false
}

// 打开时加载成员并默认选中当前 owner
watch(isOpen, (open) => {
  if (open) {
    searchQuery.value = ''
    selectedPlatformId.value = currentOwnerId.value
    loadMembers()
  }
})

watch(
  () => props.sessionId,
  () => {
    checkAndAutoOpen()
  }
)

onMounted(() => {
  checkAndAutoOpen()
})
</script>

<template>
  <UModal v-model:open="isOpen" :ui="{ content: 'max-w-md' }">
    <template #content>
      <div class="p-6">
        <!-- 头部 -->
        <div class="mb-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-full bg-linear-to-br"
              :class="chatType === 'group' ? 'from-pink-400 to-pink-600' : 'from-purple-400 to-purple-600'"
            >
              <UIcon name="i-heroicons-user" class="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
                {{ t('members.ownerPrompt.title') }}
              </h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ t('members.ownerPrompt.subtitle') }}
              </p>
            </div>
          </div>
          <UButton icon="i-heroicons-x-mark" color="neutral" variant="ghost" size="sm" @click="later" />
        </div>

        <!-- 搜索框 -->
        <UInput
          v-model="searchQuery"
          :placeholder="t('members.ownerPrompt.searchPlaceholder')"
          icon="i-heroicons-magnifying-glass"
          class="mb-3 w-full"
        />

        <!-- 成员列表 -->
        <div class="h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <div v-if="isLoading" class="flex h-full items-center justify-center">
            <UIcon name="i-heroicons-arrow-path" class="h-5 w-5 animate-spin text-gray-400" />
          </div>
          <div v-else-if="filteredMembers.length === 0" class="flex h-full items-center justify-center">
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ searchQuery ? t('members.ownerPrompt.noMatch') : t('members.ownerPrompt.empty') }}
            </p>
          </div>
          <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
            <li v-for="member in filteredMembers" :key="member.id">
              <button
                type="button"
                class="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
                :class="selectedPlatformId === member.platformId ? 'bg-primary-50 dark:bg-primary-900/20' : ''"
                @click="selectedPlatformId = member.platformId"
              >
                <img
                  v-if="member.avatar"
                  :src="member.avatar"
                  :alt="getDisplayName(member)"
                  class="h-8 w-8 shrink-0 rounded-full object-cover"
                />
                <div
                  v-else
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-gray-300 to-gray-400 text-xs font-medium text-white dark:from-gray-600 dark:to-gray-700"
                >
                  {{ getDisplayName(member).slice(0, 1) }}
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-gray-900 dark:text-white">
                    {{ getDisplayName(member) }}
                  </p>
                  <p class="truncate text-xs text-gray-500 dark:text-gray-400">{{ member.platformId }}</p>
                </div>
                <UIcon
                  v-if="selectedPlatformId === member.platformId"
                  name="i-heroicons-check-circle-solid"
                  class="h-5 w-5 shrink-0 text-primary-500"
                />
              </button>
            </li>
          </ul>
        </div>

        <!-- AI 价值说明 -->
        <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">
          {{ t('members.ownerPrompt.description') }}
        </p>

        <!-- 清除当前选择（仅已设置 owner 时显示） -->
        <div v-if="currentOwnerId" class="mt-2">
          <UButton variant="link" color="neutral" size="xs" :disabled="isSaving" @click="clearOwner">
            {{ t('members.ownerPrompt.clear') }}
          </UButton>
        </div>

        <!-- 操作按钮 -->
        <div class="mt-5 flex items-center justify-between gap-2">
          <UButton
            v-if="!currentOwnerId"
            variant="ghost"
            color="neutral"
            size="sm"
            :loading="isDismissing"
            @click="dismissForever"
          >
            {{ t('members.ownerPrompt.dontRemind') }}
          </UButton>
          <span v-else />
          <div class="flex gap-2">
            <UButton variant="ghost" color="neutral" @click="later">
              {{ t('members.ownerPrompt.later') }}
            </UButton>
            <UButton color="primary" :loading="isSaving" :disabled="!selectedPlatformId" @click="save">
              {{ t('members.ownerPrompt.save') }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
