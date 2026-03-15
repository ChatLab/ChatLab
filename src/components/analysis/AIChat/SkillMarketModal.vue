<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useSkillStore, type BuiltinSkillInfo } from '@/stores/skill'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  configure: [id: string]
  create: []
}>()

const skillStore = useSkillStore()
const { skills, builtinCatalog } = storeToRefs(skillStore)

const activeTab = ref<'local' | 'market'>('local')
const importing = new Set<string>()

onMounted(() => {
  skillStore.loadBuiltinCatalog()
})

const sortedSkills = computed(() => {
  return [...skills.value].sort((a, b) => a.name.localeCompare(b.name))
})

const sortedCatalog = computed(() => {
  return [...builtinCatalog.value].sort((a, b) => a.name.localeCompare(b.name))
})

function getChatScopeLabel(scope: string): string {
  if (scope === 'group') return t('ai.skill.config.chatScopeGroup')
  if (scope === 'private') return t('ai.skill.config.chatScopePrivate')
  return t('ai.skill.config.chatScopeAll')
}

function handleConfigure(id: string) {
  emit('configure', id)
}

async function handleDelete(id: string) {
  await skillStore.deleteSkill(id)
}

function handleCreate() {
  emit('create')
}

async function handleImport(builtinId: string) {
  if (importing.has(builtinId)) return
  importing.add(builtinId)
  try {
    await skillStore.importSkill(builtinId)
  } finally {
    importing.delete(builtinId)
  }
}

async function handleReimport(item: BuiltinSkillInfo) {
  const userSkill = skills.value.find((s) => s.builtinId === item.id)
  if (!userSkill) return
  await skillStore.reimportSkill(userSkill.id)
}
</script>

<template>
  <UModal :open="open" :ui="{ content: 'sm:max-w-xl z-50' }" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="p-6">
        <!-- 标题 -->
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100">{{ t('ai.skill.market.title') }}</h2>
          <button
            class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            @click="emit('update:open', false)"
          >
            <UIcon name="i-heroicons-x-mark" class="h-5 w-5" />
          </button>
        </div>

        <!-- Tab 切换 -->
        <div class="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
          <button
            class="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            :class="
              activeTab === 'local'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
            "
            @click="activeTab = 'local'"
          >
            {{ t('ai.skill.market.tabs.local') }}
            <span
              v-if="skills.length"
              class="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-100 px-1 text-[10px] text-primary-600 dark:bg-primary-900/30 dark:text-primary-400"
            >
              {{ skills.length }}
            </span>
          </button>
          <button
            class="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            :class="
              activeTab === 'market'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
            "
            @click="activeTab = 'market'"
          >
            {{ t('ai.skill.market.tabs.market') }}
          </button>
        </div>

        <!-- 本地技能 Tab -->
        <div v-show="activeTab === 'local'">
          <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">{{ t('ai.skill.market.localHint') }}</p>
          <div class="max-h-[400px] space-y-3 overflow-y-auto pr-1">
            <div
              v-for="skill in sortedSkills"
              :key="skill.id"
              class="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 transition-colors dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {{ skill.name }}
                  </h3>
                  <span
                    class="inline-flex shrink-0 items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                  >
                    {{ getChatScopeLabel(skill.chatScope) }}
                  </span>
                </div>
                <p class="mt-1 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
                  {{ skill.description }}
                </p>
                <div v-if="skill.tags.length" class="mt-1.5 flex flex-wrap gap-1">
                  <span
                    v-for="tag in skill.tags"
                    :key="tag"
                    class="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                  >
                    {{ tag }}
                  </span>
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-1.5">
                <button
                  class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                  :title="t('common.edit')"
                  @click.stop="handleConfigure(skill.id)"
                >
                  <UIcon name="i-heroicons-pencil-square" class="h-4 w-4" />
                </button>
                <button
                  class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                  :title="t('common.delete')"
                  @click.stop="handleDelete(skill.id)"
                >
                  <UIcon name="i-heroicons-trash" class="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <!-- 新增技能按钮 -->
          <button
            type="button"
            class="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gray-300 py-4 text-sm text-gray-500 transition-colors hover:border-primary-400 hover:text-primary-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-primary-500 dark:hover:text-primary-400"
            @click="handleCreate"
          >
            <UIcon name="i-heroicons-plus" class="h-4 w-4" />
            {{ t('ai.skill.market.addSkill') }}
          </button>

          <div v-if="sortedSkills.length === 0" class="py-12 text-center text-sm text-gray-400">
            {{ t('ai.skill.market.noLocal') }}
          </div>
        </div>

        <!-- 技能市场 Tab -->
        <div v-show="activeTab === 'market'">
          <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">{{ t('ai.skill.market.marketHint') }}</p>
          <div class="max-h-[400px] space-y-3 overflow-y-auto pr-1">
            <div
              v-for="item in sortedCatalog"
              :key="item.id"
              class="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 transition-colors dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {{ item.name }}
                  </h3>
                  <span
                    class="inline-flex shrink-0 items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                  >
                    {{ getChatScopeLabel(item.chatScope) }}
                  </span>
                  <span
                    v-if="item.imported && item.hasUpdate"
                    class="inline-flex shrink-0 items-center rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                  >
                    {{ t('ai.skill.market.updateAvailable') }}
                  </span>
                </div>
                <p class="mt-1 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
                  {{ item.description }}
                </p>
                <div v-if="item.tags.length" class="mt-1.5 flex flex-wrap gap-1">
                  <span
                    v-for="tag in item.tags"
                    :key="tag"
                    class="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                  >
                    {{ tag }}
                  </span>
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-2">
                <button
                  v-if="item.imported && item.hasUpdate"
                  class="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-orange-600"
                  @click="handleReimport(item)"
                >
                  {{ t('ai.skill.market.reimport') }}
                </button>

                <span
                  v-else-if="item.imported"
                  class="px-3 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-500"
                >
                  {{ t('ai.skill.market.imported') }}
                </span>

                <button
                  v-else
                  class="rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-600"
                  @click="handleImport(item.id)"
                >
                  {{ t('ai.skill.market.import') }}
                </button>
              </div>
            </div>
          </div>

          <div v-if="sortedCatalog.length === 0" class="py-12 text-center text-sm text-gray-400">
            {{ t('ai.skill.market.noCatalog') }}
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
