<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MemberWithStats } from '@/types/analysis'
import OwnerSelector from '@/components/analysis/member/OwnerSelector.vue'

const { t } = useI18n()

// Props
const props = withDefaults(
  defineProps<{
    sessionId: string
    showHeader?: boolean
  }>(),
  {
    showHeader: true,
  }
)

// 成员列表
const members = ref<MemberWithStats[]>([])
const isLoading = ref(false)

// 正在保存别名的成员ID
const savingAliasesId = ref<number | null>(null)

// 合并成员状态
const selectedMergeIds = ref<Set<number>>(new Set())
const showMergeModal = ref(false)
const isMerging = ref(false)

// 获取成员显示名称
function getDisplayName(member: MemberWithStats): string {
  return member.groupNickname || member.accountName || member.platformId
}

// 获取成员首字符（用于头像）
function getFirstChar(member: MemberWithStats): string {
  const name = getDisplayName(member)
  return name.slice(0, 1)
}

const selectedMergeMembers = computed(() => members.value.filter((member) => selectedMergeIds.value.has(member.id)))
const canMergeSelected = computed(() => selectedMergeMembers.value.length === 2)

const mergePlan = computed(() => {
  if (selectedMergeMembers.value.length !== 2) return null
  const [memberA, memberB] = selectedMergeMembers.value
  if (
    memberB.messageCount > memberA.messageCount ||
    (memberB.messageCount === memberA.messageCount && memberB.id < memberA.id)
  ) {
    return { primary: memberB, secondary: memberA }
  }
  return { primary: memberA, secondary: memberB }
})

// 计算消息总数
const totalMessageCount = computed(() => {
  return members.value.reduce((sum, m) => sum + m.messageCount, 0)
})

// 计算每个成员的消息占比
function getPercentage(count: number): number {
  if (totalMessageCount.value === 0) return 0
  return Math.round((count / totalMessageCount.value) * 100)
}

// 加载成员列表
async function loadMembers() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    members.value = await window.chatApi.getMembers(props.sessionId)
  } catch (error) {
    console.error('加载成员列表失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 更新别名
async function updateAliases(member: MemberWithStats, newAliases: string[]) {
  const aliasesToSave = JSON.parse(JSON.stringify(newAliases)) as string[]

  const currentAliases = JSON.stringify(member.aliases)
  const newAliasesStr = JSON.stringify(aliasesToSave)
  if (currentAliases === newAliasesStr) return

  savingAliasesId.value = member.id
  try {
    const success = await window.chatApi.updateMemberAliases(props.sessionId, member.id, aliasesToSave)
    if (success) {
      const idx = members.value.findIndex((m) => m.id === member.id)
      if (idx !== -1) {
        members.value[idx] = {
          ...members.value[idx],
          aliases: aliasesToSave,
        }
      }
    }
  } catch (error) {
    console.error('保存别名失败:', error)
  } finally {
    savingAliasesId.value = null
  }
}

function toggleMergeSelection(memberId: number) {
  const next = new Set(selectedMergeIds.value)
  if (next.has(memberId)) {
    next.delete(memberId)
  } else {
    next.add(memberId)
  }
  selectedMergeIds.value = next
}

function openMergeModal() {
  if (!canMergeSelected.value) return
  showMergeModal.value = true
}

function clearMergeSelection() {
  selectedMergeIds.value = new Set()
}

async function confirmMerge() {
  if (!mergePlan.value) return
  isMerging.value = true
  try {
    const success = await window.chatApi.mergeMembers(
      props.sessionId,
      mergePlan.value.primary.id,
      mergePlan.value.secondary.id
    )
    if (success) {
      showMergeModal.value = false
      clearMergeSelection()
      await loadMembers()
    }
  } catch (error) {
    console.error('合并成员失败:', error)
  } finally {
    isMerging.value = false
  }
}

// 监听 sessionId 变化
watch(
  () => props.sessionId,
  () => {
    clearMergeSelection()
    loadMembers()
  },
  { immediate: true }
)

onMounted(() => {
  loadMembers()
})
</script>

<template>
  <div class="main-content max-w-4xl p-6">
    <!-- 页面标题 -->
    <div v-if="props.showHeader" class="mb-6">
      <div class="flex items-center gap-3">
        <div>
          <h2 class="text-xl font-bold text-gray-900 dark:text-white">{{ t('members.private.title') }}</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            {{ t('members.private.description', { count: members.length }) }}
          </p>
        </div>
      </div>
    </div>

    <!-- Owner配置 -->
    <OwnerSelector
      class="mb-6"
      :session-id="sessionId"
      :members="members"
      :is-loading="isLoading"
      chat-type="private"
    />

    <!-- 加载状态 -->
    <div v-if="isLoading" class="flex h-60 items-center justify-center">
      <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin text-pink-500" />
    </div>

    <div v-if="!isLoading && members.length > 1" class="mb-4 flex items-center justify-end gap-2">
      <span class="text-xs text-gray-500 dark:text-gray-400">
        {{ t('members.list.mergeSelectedCount', { count: selectedMergeIds.size }) }}
      </span>
      <UButton icon="i-heroicons-link" size="sm" color="primary" :disabled="!canMergeSelected" @click="openMergeModal">
        {{ t('members.list.mergeSelected') }}
      </UButton>
    </div>

    <!-- 成员卡片列表 -->
    <div v-if="!isLoading" class="grid gap-4 md:grid-cols-2">
      <div
        v-for="member in members"
        :key="member.id"
        class="relative rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900"
      >
        <div class="absolute right-4 top-4">
          <UCheckbox :model-value="selectedMergeIds.has(member.id)" @click.stop="toggleMergeSelection(member.id)" />
        </div>

        <!-- 成员头部信息 -->
        <div class="flex items-start gap-4">
          <!-- 头像：优先显示真实头像，否则显示首字母 -->
          <img
            v-if="member.avatar"
            :src="member.avatar"
            :alt="getDisplayName(member)"
            class="h-14 w-14 shrink-0 rounded-full object-cover"
          />
          <div
            v-else
            class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-pink-400 to-pink-600 text-lg font-medium text-white"
          >
            {{ getFirstChar(member) }}
          </div>

          <!-- 名称和ID -->
          <div class="flex-1 min-w-0">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white truncate">
              {{ getDisplayName(member) }}
            </h3>
            <p class="text-sm text-gray-500 dark:text-gray-400">ID: {{ member.platformId }}</p>
          </div>
        </div>

        <!-- 消息统计 -->
        <div class="mt-4 flex items-center gap-4">
          <div class="flex-1">
            <div class="flex items-baseline justify-between">
              <span class="text-sm text-gray-500 dark:text-gray-400">{{ t('members.private.messageCount') }}</span>
              <span class="text-lg font-bold text-gray-900 dark:text-white">
                {{ member.messageCount.toLocaleString() }}
              </span>
            </div>
            <!-- 进度条 -->
            <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div
                class="h-full rounded-full bg-linear-to-r from-pink-400 to-pink-600 transition-all duration-500"
                :style="{ width: `${getPercentage(member.messageCount)}%` }"
              />
            </div>
            <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {{ t('members.private.percentage', { value: getPercentage(member.messageCount) }) }}
            </p>
          </div>
        </div>

        <!-- 别名编辑 -->
        <div class="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
          <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ t('members.private.customAlias') }}
          </label>
          <div class="relative">
            <UInputTags
              :model-value="member.aliases"
              :placeholder="t('members.private.aliasPlaceholder')"
              class="w-full"
              @update:model-value="(val) => updateAliases(member, val)"
            />
            <!-- 保存中指示器 -->
            <div v-if="savingAliasesId === member.id" class="absolute right-3 top-1/2 -translate-y-1/2">
              <UIcon name="i-heroicons-arrow-path" class="h-4 w-4 animate-spin text-pink-500" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="!isLoading && members.length === 0" class="flex h-60 flex-col items-center justify-center">
      <UIcon name="i-heroicons-user-group" class="mb-3 h-12 w-12 text-gray-300 dark:text-gray-600" />
      <p class="text-gray-500 dark:text-gray-400">{{ t('members.private.empty') }}</p>
    </div>

    <!-- 提示信息 -->
    <div v-if="members.length > 0" class="mt-6 flex items-start gap-3 rounded-xl bg-blue-50 p-4 dark:bg-blue-900/20">
      <UIcon name="i-heroicons-information-circle" class="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
      <div>
        <p class="text-sm font-medium text-blue-800 dark:text-blue-200">{{ t('members.private.tipTitle') }}</p>
        <p class="mt-1 text-sm text-blue-700 dark:text-blue-300">
          {{ t('members.private.tipContent') }}
        </p>
      </div>
    </div>

    <!-- 合并确认弹窗 -->
    <UModal :open="showMergeModal" :ui="{ content: 'max-w-md' }" @update:open="showMergeModal = $event">
      <template #content>
        <div class="p-6">
          <div class="mb-4 flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <UIcon name="i-heroicons-link" class="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ t('members.list.mergeModal.title') }}
            </h3>
          </div>
          <p class="mb-2 text-sm text-gray-600 dark:text-gray-400">
            {{
              t('members.list.mergeModal.content', {
                source: mergePlan ? getDisplayName(mergePlan.secondary) : '',
                sourceCount: mergePlan ? mergePlan.secondary.messageCount.toLocaleString() : '0',
                target: mergePlan ? getDisplayName(mergePlan.primary) : '',
                targetCount: mergePlan ? mergePlan.primary.messageCount.toLocaleString() : '0',
              })
            }}
          </p>
          <p class="mb-6 text-xs text-amber-700 dark:text-amber-300">{{ t('members.list.mergeModal.hint') }}</p>
          <div class="flex justify-end gap-2">
            <UButton variant="outline" :disabled="isMerging" @click="showMergeModal = false">
              {{ t('members.list.mergeModal.cancel') }}
            </UButton>
            <UButton color="primary" :loading="isMerging" @click="confirmMerge">
              {{ t('members.list.mergeModal.confirm') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
