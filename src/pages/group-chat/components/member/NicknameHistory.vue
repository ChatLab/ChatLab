<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MemberWithStats, MemberNameHistory } from '@/types/analysis'
import { SectionCard, EmptyState, LoadingState } from '@/components/UI'
import { formatPeriod } from '@/utils'

const { t } = useI18n()

// Props
const props = defineProps<{
  sessionId: string
}>()

// 成员列表（用于获取历史记录）
const members = ref<MemberWithStats[]>([])

// ==================== 昵称变更记录 ====================
interface MemberWithHistory {
  memberId: number
  name: string
  history: MemberNameHistory[]
}

const membersWithNicknameChanges = ref<MemberWithHistory[]>([])
const isLoadingHistory = ref(false)

// 获取成员显示名称
function getDisplayName(member: MemberWithStats): string {
  return member.groupNickname || member.accountName || member.platformId
}

// 加载成员列表
async function loadMembers() {
  if (!props.sessionId) return
  try {
    members.value = await window.chatApi.getMembers(props.sessionId)
  } catch (error) {
    console.error('加载成员列表失败:', error)
  }
}

async function loadMembersWithNicknameChanges() {
  if (!props.sessionId || members.value.length === 0) return

  isLoadingHistory.value = true
  const membersWithChanges: MemberWithHistory[] = []

  try {
    const historyPromises = members.value.map((member) =>
      window.chatApi.getMemberNameHistory(props.sessionId, member.id)
    )

    const allHistories = await Promise.all(historyPromises)

    members.value.forEach((member, index) => {
      const history = allHistories[index]
      if (history.length > 2) {
        membersWithChanges.push({
          memberId: member.id,
          name: getDisplayName(member),
          history,
        })
      }
    })

    membersWithNicknameChanges.value = membersWithChanges
  } catch (error) {
    console.error('加载昵称变更记录失败:', error)
  } finally {
    isLoadingHistory.value = false
  }
}

// 监听 sessionId 变化
watch(
  () => props.sessionId,
  async () => {
    await loadMembers()
  },
  { immediate: true }
)

// 成员加载完成后加载昵称变更记录
watch(
  () => members.value.length,
  () => {
    if (members.value.length > 0) {
      loadMembersWithNicknameChanges()
    }
  }
)

onMounted(async () => {
  if (members.value.length === 0) {
    await loadMembers()
  }
})
</script>

<template>
  <div class="main-content max-w-5xl p-6">
    <p class="mb-4 text-sm text-gray-500 dark:text-gray-400 no-capture">
      {{ t('members.nicknameHistory.note') }}
    </p>
    <!-- 昵称变更记录 -->
    <SectionCard
      :title="t('members.nicknameHistory.title')"
      :description="
        isLoadingHistory
          ? t('members.nicknameHistory.loading')
          : membersWithNicknameChanges.length > 0
            ? t('members.nicknameHistory.hasChanges', { count: membersWithNicknameChanges.length })
            : t('members.nicknameHistory.noChanges')
      "
    >
      <div
        v-if="!isLoadingHistory && membersWithNicknameChanges.length > 0"
        class="divide-y divide-gray-100 dark:divide-gray-800"
      >
        <div
          v-for="member in membersWithNicknameChanges"
          :key="member.memberId"
          class="flex items-start gap-3 px-5 py-3"
        >
          <div class="w-32 shrink-0 pt-0.5 font-medium text-gray-900 dark:text-white">
            {{ member.name }}
          </div>

          <div class="flex flex-1 flex-wrap items-center gap-2">
            <template v-for="(item, index) in member.history" :key="index">
              <div class="flex items-center gap-1.5 rounded-lg bg-gray-50 px-3 py-1.5 dark:bg-gray-800">
                <span
                  class="text-sm"
                  :class="item.endTs === null ? 'font-semibold text-pink-600' : 'text-gray-700 dark:text-gray-300'"
                >
                  {{ item.name }}
                </span>
                <UBadge v-if="item.endTs === null" color="primary" variant="soft" size="xs">
                  {{ t('members.nicknameHistory.current') }}
                </UBadge>
                <span class="text-xs text-gray-400">({{ formatPeriod(item.startTs, item.endTs) }})</span>
              </div>

              <span v-if="index < member.history.length - 1" class="text-gray-300 dark:text-gray-600">→</span>
            </template>
          </div>
        </div>
      </div>

      <EmptyState v-else-if="!isLoadingHistory" :text="t('members.nicknameHistory.empty')" />

      <LoadingState v-else :text="t('members.nicknameHistory.loadingText')" />
    </SectionCard>
  </div>
</template>
