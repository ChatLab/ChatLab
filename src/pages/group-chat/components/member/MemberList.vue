<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MemberWithStats } from '@/types/analysis'
import OwnerSelector from '@/components/analysis/member/OwnerSelector.vue'

const { t } = useI18n()

// Props
const props = defineProps<{
  sessionId: string
}>()

// Emits
const emit = defineEmits<{
  'data-changed': []
}>()

// 成员列表（当前页）
const members = ref<MemberWithStats[]>([])
const allMembers = ref<MemberWithStats[]>([]) // 用于 OwnerSelector（仅加载一次）
const isLoading = ref(false)
const searchQuery = ref('')

// 删除确认状态
const deletingMember = ref<MemberWithStats | null>(null)
const isDeleting = ref(false)

// 分页配置
const pageSize = 20
const currentPage = ref(1)
const total = ref(0)
const totalPages = ref(0)

// 排序配置
const sortOrder = ref<'desc' | 'asc'>('desc') // desc = 发言多在前

// 正在保存别名的成员ID（用于显示加载状态）
const savingAliasesId = ref<number | null>(null)

// 搜索防抖定时器
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

// 获取成员显示名称
function getDisplayName(member: MemberWithStats): string {
  return member.groupNickname || member.accountName || member.platformId
}

// 获取成员首字符（用于头像）
function getFirstChar(member: MemberWithStats): string {
  const name = getDisplayName(member)
  return name.slice(0, 1)
}

// 切换排序
function toggleSort() {
  sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  currentPage.value = 1
  loadMembers()
}

// 加载成员列表（分页）
async function loadMembers() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    const result = await window.chatApi.getMembersPaginated(props.sessionId, {
      page: currentPage.value,
      pageSize,
      search: searchQuery.value.trim(),
      sortOrder: sortOrder.value,
    })
    members.value = result.members
    total.value = result.total
    totalPages.value = result.totalPages
  } catch (error) {
    console.error('加载成员列表失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 加载所有成员（用于 OwnerSelector）
async function loadAllMembers() {
  if (!props.sessionId) return
  try {
    allMembers.value = await window.chatApi.getMembers(props.sessionId)
  } catch (error) {
    console.error('加载所有成员失败:', error)
  }
}

// 直接更新别名（输入框失焦或回车时触发）
async function updateAliases(member: MemberWithStats, newAliases: string[]) {
  // 将 Vue 响应式数组转换为普通数组，避免 IPC 序列化问题
  const aliasesToSave = JSON.parse(JSON.stringify(newAliases)) as string[]

  // 检查是否有变化
  const currentAliases = JSON.stringify(member.aliases)
  const newAliasesStr = JSON.stringify(aliasesToSave)
  if (currentAliases === newAliasesStr) return

  savingAliasesId.value = member.id
  try {
    const success = await window.chatApi.updateMemberAliases(props.sessionId, member.id, aliasesToSave)
    if (success) {
      // 更新本地数据 - 找到对应成员并更新
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

// 显示删除确认
function showDeleteConfirm(member: MemberWithStats) {
  deletingMember.value = member
}

// 取消删除
function cancelDelete() {
  deletingMember.value = null
}

// 确认删除
async function confirmDelete() {
  if (!deletingMember.value) return
  isDeleting.value = true
  try {
    const success = await window.chatApi.deleteMember(props.sessionId, deletingMember.value.id)
    if (success) {
      // 重新加载当前页数据
      await loadMembers()
      // 同时更新 allMembers（用于 OwnerSelector）
      await loadAllMembers()
      // 通知父组件刷新数据
      emit('data-changed')
    }
  } catch (error) {
    console.error('删除成员失败:', error)
  } finally {
    isDeleting.value = false
    deletingMember.value = null
  }
}

// 搜索时重置页码并防抖加载
watch(searchQuery, () => {
  currentPage.value = 1
  // 防抖：延迟 300ms 后执行搜索
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer)
  }
  searchDebounceTimer = setTimeout(() => {
    loadMembers()
  }, 300)
})

// 监听页码变化
watch(currentPage, () => {
  loadMembers()
})

// 监听 sessionId 变化
watch(
  () => props.sessionId,
  () => {
    searchQuery.value = ''
    currentPage.value = 1
    loadMembers()
    loadAllMembers()
  },
  { immediate: true }
)

onMounted(() => {
  loadMembers()
  loadAllMembers()
})
</script>

<template>
  <div class="main-content max-w-5xl p-6">
    <!-- 页面标题 -->
    <div class="mb-6">
      <div class="flex items-center gap-3">
        <div>
          <h2 class="text-xl font-bold text-gray-900 dark:text-white">{{ t('members.list.title') }}</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            {{ t('members.list.description', { count: total }) }}
          </p>
        </div>
      </div>
    </div>

    <!-- Owner配置 -->
    <OwnerSelector
      class="mb-6"
      :session-id="sessionId"
      :members="allMembers"
      :is-loading="isLoading"
      chat-type="group"
    />

    <!-- 搜索框 -->
    <div class="mb-4">
      <UInput
        v-model="searchQuery"
        :placeholder="t('members.list.searchPlaceholder')"
        icon="i-heroicons-magnifying-glass"
        class="w-100"
      >
        <template v-if="searchQuery" #trailing>
          <UButton icon="i-heroicons-x-mark" variant="link" color="neutral" size="xs" @click="searchQuery = ''" />
        </template>
      </UInput>
    </div>

    <!-- 成员列表 -->
    <div class="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <!-- 加载状态 -->
      <div v-if="isLoading" class="flex h-60 items-center justify-center">
        <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin text-pink-500" />
      </div>

      <!-- 空状态 -->
      <div v-else-if="members.length === 0" class="flex h-60 flex-col items-center justify-center">
        <UIcon name="i-heroicons-user-group" class="mb-3 h-12 w-12 text-gray-300 dark:text-gray-600" />
        <p class="text-gray-500 dark:text-gray-400">
          {{ searchQuery ? t('members.list.noMatch') : t('members.list.empty') }}
        </p>
      </div>

      <!-- 成员表格 -->
      <div v-else>
        <div class="max-h-[500px] overflow-y-auto">
          <table class="w-full">
            <thead class="sticky top-0 bg-gray-50 dark:bg-gray-800">
              <tr class="text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                <th class="px-4 py-4">{{ t('members.list.table.accountName') }}</th>
                <th class="px-4 py-4">{{ t('members.list.table.groupNickname') }}</th>
                <th class="px-4 py-4">
                  <button
                    class="flex items-center gap-1.5 hover:text-gray-700 dark:hover:text-gray-200"
                    @click="toggleSort"
                  >
                    {{ t('members.list.table.messageCount') }}
                    <UIcon
                      :name="sortOrder === 'desc' ? 'i-heroicons-arrow-down' : 'i-heroicons-arrow-up'"
                      class="h-3.5 w-3.5"
                    />
                  </button>
                </th>
                <th class="px-4 py-4 w-64">{{ t('members.list.table.customAlias') }}</th>
                <th class="px-4 py-4 text-right">{{ t('members.list.table.actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-for="member in members" :key="member.id" class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <!-- 账号名称 (ID) -->
                <td class="px-4 py-4">
                  <div class="flex items-center gap-2">
                    <!-- 头像：优先显示真实头像，否则显示首字母 -->
                    <img
                      v-if="member.avatar"
                      :src="member.avatar"
                      :alt="getDisplayName(member)"
                      class="h-8 w-8 shrink-0 rounded-full object-cover"
                    />
                    <div
                      v-else
                      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-400 to-pink-600 text-xs font-medium text-white"
                    >
                      {{ getFirstChar(member) }}
                    </div>
                    <div>
                      <span class="text-sm font-medium text-gray-900 dark:text-white">
                        {{ member.accountName || '-' }}
                      </span>
                      <span class="ml-1 text-sm text-gray-500 dark:text-gray-400">({{ member.platformId }})</span>
                    </div>
                  </div>
                </td>

                <!-- 群昵称 -->
                <td class="px-4 py-4">
                  <span v-if="member.groupNickname" class="text-sm font-medium text-gray-900 dark:text-white">
                    {{ member.groupNickname }}
                  </span>
                  <span v-else class="text-sm text-gray-400 dark:text-gray-500">-</span>
                </td>

                <!-- 消息数 -->
                <td class="px-4 py-4">
                  <span class="text-sm font-semibold text-gray-900 dark:text-white">
                    {{ member.messageCount.toLocaleString() }}
                  </span>
                </td>

                <!-- 别名 - 直接编辑 -->
                <td class="px-4 py-4">
                  <div class="max-w-xs">
                    <UInputTags
                      :model-value="member.aliases"
                      :placeholder="t('members.list.aliasPlaceholder')"
                      class="w-80"
                      @update:model-value="(val) => updateAliases(member, val)"
                    />
                    <!-- 保存中指示器 -->
                    <div v-if="savingAliasesId === member.id" class="absolute right-2 top-1/2 -translate-y-1/2">
                      <UIcon name="i-heroicons-arrow-path" class="h-4 w-4 animate-spin text-pink-500" />
                    </div>
                  </div>
                </td>

                <!-- 操作 -->
                <td class="px-4 py-4 text-right">
                  <UButton :label="t('members.list.delete')" size="xs" @click="showDeleteConfirm(member)" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 分页 -->
        <div
          v-if="totalPages > 1"
          class="flex items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-700"
        >
          <p class="text-sm text-gray-500 dark:text-gray-400">
            {{
              t('members.list.pagination', {
                start: (currentPage - 1) * pageSize + 1,
                end: Math.min(currentPage * pageSize, total),
                total: total,
              })
            }}
          </p>
          <div class="flex items-center gap-2">
            <UButton
              icon="i-heroicons-chevron-left"
              variant="outline"
              size="sm"
              :disabled="currentPage === 1 || isLoading"
              @click="currentPage--"
            />
            <span class="text-sm font-medium text-gray-600 dark:text-gray-300">
              {{ currentPage }} / {{ totalPages }}
            </span>
            <UButton
              icon="i-heroicons-chevron-right"
              variant="outline"
              size="sm"
              :disabled="currentPage >= totalPages || isLoading"
              @click="currentPage++"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 提示信息 -->
    <div class="mt-4 flex items-start gap-3 rounded-xl bg-amber-50 p-4 dark:bg-amber-900/20">
      <UIcon name="i-heroicons-exclamation-triangle" class="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
      <div>
        <p class="text-sm font-medium text-amber-800 dark:text-amber-200">
          {{ t('members.list.tip') }}
        </p>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <UModal :open="!!deletingMember" :ui="{ content: 'max-w-sm' }" @update:open="deletingMember = null">
      <template #content>
        <div class="p-6 text-center">
          <div
            class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30"
          >
            <UIcon name="i-heroicons-exclamation-triangle" class="h-7 w-7 text-red-500" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-white">{{ t('members.list.modal.title') }}</h3>
          <p class="mb-6 text-sm text-gray-500 dark:text-gray-400">
            {{
              t('members.list.modal.content', {
                name: deletingMember ? getDisplayName(deletingMember) : '',
                count: deletingMember?.messageCount.toLocaleString(),
              })
            }}
          </p>
          <div class="flex justify-center gap-3">
            <UButton variant="outline" @click="cancelDelete">{{ t('members.list.modal.cancel') }}</UButton>
            <UButton color="error" :loading="isDeleting" @click="confirmDelete">
              {{ t('members.list.modal.confirm') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
