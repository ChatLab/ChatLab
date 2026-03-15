<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useSkillStore } from '@/stores/skill'
import SkillCard from './SkillCard.vue'

const { t } = useI18n()

const props = defineProps<{
  chatType: 'group' | 'private'
}>()

const emit = defineEmits<{
  manage: []
}>()

const skillStore = useSkillStore()
const { compatibleSkills, activeSkillId, isLoaded } = storeToRefs(skillStore)

watch(
  () => props.chatType,
  (chatType) => {
    skillStore.setFilterContext(chatType)
  },
  { immediate: true }
)

onMounted(async () => {
  if (!isLoaded.value) {
    await skillStore.loadSkills()
  }
})

function handleSelectSkill(id: string) {
  if (activeSkillId.value === id) {
    skillStore.activateSkill(null)
  } else {
    skillStore.activateSkill(id)
  }
}

function handleFreeChat() {
  skillStore.activateSkill(null)
}
</script>

<template>
  <div class="space-y-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
    <!-- 标题 + 管理入口 -->
    <div class="flex items-center justify-between">
      <span class="text-xs font-medium text-gray-600 dark:text-gray-300">{{ t('ai.skill.selector.title') }}</span>
      <button
        class="text-[11px] text-gray-400 transition-colors hover:text-primary-500 dark:text-gray-500 dark:hover:text-primary-400"
        @click="emit('manage')"
      >
        {{ t('ai.skill.selector.manage') }}
      </button>
    </div>

    <!-- 自由对话选项 -->
    <div
      class="cursor-pointer rounded-lg border px-3 py-2 transition-all duration-150"
      :class="[
        !activeSkillId
          ? 'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-950/30'
          : 'border-gray-200 hover:border-primary-300 dark:border-gray-700 dark:hover:border-primary-600',
      ]"
      @click="handleFreeChat"
    >
      <div class="flex items-center gap-2">
        <UIcon name="i-heroicons-chat-bubble-left-right" class="h-3.5 w-3.5 text-gray-500" />
        <div>
          <span class="text-xs font-medium text-gray-900 dark:text-gray-100">
            {{ t('ai.skill.selector.freeChat') }}
          </span>
          <p class="text-[11px] text-gray-400 dark:text-gray-500">
            {{ t('ai.skill.selector.freeChatDesc') }}
          </p>
        </div>
      </div>
    </div>

    <!-- 技能列表 -->
    <div v-if="compatibleSkills.length > 0" class="max-h-48 space-y-1.5 overflow-y-auto">
      <SkillCard
        v-for="skill in compatibleSkills"
        :key="skill.id"
        :skill="skill"
        :selected="activeSkillId === skill.id"
        @select="handleSelectSkill"
      />
    </div>

    <!-- 无可用技能 -->
    <div v-else-if="isLoaded" class="py-3 text-center">
      <p class="text-xs text-gray-400 dark:text-gray-500">{{ t('ai.skill.selector.noSkills') }}</p>
      <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{{ t('ai.skill.selector.noSkillsHint') }}</p>
    </div>
  </div>
</template>
