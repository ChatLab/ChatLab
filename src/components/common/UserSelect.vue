<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MemberWithStats } from '@/types/analysis'

const { t } = useI18n()

// Props
const props = defineProps<{
  sessionId: string
  modelValue: number | null
}>()

// Emits
const emit = defineEmits<{
  (e: 'update:modelValue', value: number | null): void
}>()

// 成员数据
const members = ref<MemberWithStats[]>([])
const isLoading = ref(false)

// 特殊值表示全部成员
const ALL_MEMBERS_VALUE = '__ALL__'

// 内部选中值（字符串类型，通过 value-key 指定）
const internalValue = computed({
  get: () => {
    return props.modelValue === null ? ALL_MEMBERS_VALUE : String(props.modelValue)
  },
  set: (val: string) => {
    emit('update:modelValue', val === ALL_MEMBERS_VALUE ? null : parseInt(val))
  },
})

// 成员选项
const memberOptions = computed(() => {
  const options: { value: string; label: string }[] = [
    { value: ALL_MEMBERS_VALUE, label: t('common.userSelect.allMembers') },
  ]
  members.value.forEach((m) => {
    const displayName = m.groupNickname || m.accountName || m.platformId
    options.push({
      value: String(m.id),
      label: `${displayName} (${m.messageCount})`,
    })
  })
  return options
})

// 加载成员列表
async function loadMembers() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    const result = await window.chatApi.getMembers(props.sessionId)
    // 按消息数排序
    members.value = result.sort((a, b) => b.messageCount - a.messageCount)
  } catch (error) {
    console.error('加载成员列表失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 监听 sessionId 变化
watch(
  () => props.sessionId,
  () => {
    emit('update:modelValue', null) // 重置选择
    loadMembers()
  },
  { immediate: true }
)
</script>

<template>
  <USelectMenu
    v-model="internalValue"
    :items="memberOptions"
    :loading="isLoading"
    :virtualize="{ estimateSize: 32, overscan: 10 }"
    value-key="value"
    class="w-48"
  />
</template>
