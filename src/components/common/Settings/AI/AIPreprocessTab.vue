<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import type { PreprocessConfig } from '@electron/preload/index'

const { t, te } = useI18n()
const settingsStore = useSettingsStore()
const { aiPreprocessConfig } = storeToRefs(settingsStore)

onMounted(() => settingsStore.ensureDesensitizeRules())

const newKeyword = ref('')
const expandedBuiltinGroups = ref<Record<string, boolean>>({})

type DesensitizeRuleView = PreprocessConfig['desensitizeRules'][number]

const BUILTIN_GROUP_ORDER = [
  'credentials',
  'global_contact',
  'global_financial',
  'global_network',
  'region_cn',
  'region_us',
  'region_jp',
  'region_kr',
]

function addKeyword() {
  const kw = newKeyword.value.trim()
  if (!kw) return
  if (aiPreprocessConfig.value.blacklistKeywords.includes(kw)) {
    newKeyword.value = ''
    return
  }
  aiPreprocessConfig.value.blacklistKeywords.push(kw)
  newKeyword.value = ''
}

function removeKeyword(index: number) {
  aiPreprocessConfig.value.blacklistKeywords.splice(index, 1)
}

// 脱敏规则：内置 vs 自定义
const builtinRules = computed(() => aiPreprocessConfig.value.desensitizeRules.filter((r) => r.builtin))
const customRules = computed(() => aiPreprocessConfig.value.desensitizeRules.filter((r) => !r.builtin))
const builtinRuleGroups = computed(() => {
  const groups = new Map<string, DesensitizeRuleView[]>()
  for (const rule of builtinRules.value) {
    const groupId = rule.group ?? 'global_contact'
    groups.set(groupId, [...(groups.get(groupId) ?? []), rule])
  }
  return BUILTIN_GROUP_ORDER.map((id) => ({ id, rules: groups.get(id) ?? [] })).filter(
    (group) => group.rules.length > 0
  )
})

// 自定义规则表单
const customForm = ref({ name: '', pattern: '', replacement: '' })
const regexError = ref('')

function getRuleLabel(rule: { id: string; label: string; builtin: boolean }): string {
  const key = `settings.desensitize.rules.${rule.id}`
  return te(key) ? t(key) : rule.label
}

function getRuleDesc(rule: { id: string; builtin: boolean }): string {
  const key = `settings.desensitize.rules.${rule.id}_desc`
  return te(key) ? t(key) : ''
}

function getGroupLabel(groupId: string): string {
  const key = `settings.desensitize.groups.${groupId}`
  return te(key) ? t(key) : groupId
}

function getGroupDesc(groupId: string): string {
  const key = `settings.desensitize.groups.${groupId}_desc`
  return te(key) ? t(key) : ''
}

function isGroupExpanded(groupId: string): boolean {
  return expandedBuiltinGroups.value[groupId] ?? false
}

function toggleGroupExpanded(groupId: string) {
  expandedBuiltinGroups.value = {
    ...expandedBuiltinGroups.value,
    [groupId]: !isGroupExpanded(groupId),
  }
}

function getGroupState(rules: Array<{ enabled: boolean }>): { checked: boolean; indeterminate: boolean } {
  const enabledCount = rules.filter((rule) => rule.enabled).length
  return {
    checked: rules.length > 0 && enabledCount === rules.length,
    indeterminate: enabledCount > 0 && enabledCount < rules.length,
  }
}

function setBuiltinOverride(ruleId: string, enabled: boolean) {
  aiPreprocessConfig.value.desensitizeBuiltinRuleOverrides = {
    ...(aiPreprocessConfig.value.desensitizeBuiltinRuleOverrides ?? {}),
    [ruleId]: enabled,
  }
}

function toggleRule(ruleId: string) {
  const rule = aiPreprocessConfig.value.desensitizeRules.find((r) => r.id === ruleId)
  if (!rule) return
  rule.enabled = !rule.enabled
  if (rule.builtin) {
    setBuiltinOverride(rule.id, rule.enabled)
  }
}

function setRuleEnabled(rule: { id: string; enabled: boolean; builtin: boolean }, enabled: boolean) {
  rule.enabled = enabled
  if (rule.builtin) {
    setBuiltinOverride(rule.id, enabled)
  }
}

function setGroupEnabled(rules: Array<{ id: string; enabled: boolean; builtin: boolean }>, enabled: boolean) {
  for (const rule of rules) {
    setRuleEnabled(rule, enabled)
  }
}

function resetBuiltinRules() {
  const overrides = { ...(aiPreprocessConfig.value.desensitizeBuiltinRuleOverrides ?? {}) }
  for (const rule of builtinRules.value) {
    delete overrides[rule.id]
    rule.enabled = true
  }
  aiPreprocessConfig.value.desensitizeBuiltinRuleOverrides = overrides
}

function addCustomRule() {
  const name = customForm.value.name.trim()
  const pattern = customForm.value.pattern.trim()
  const replacement = customForm.value.replacement.trim()

  if (!name || !pattern || !replacement) return

  try {
    new RegExp(pattern)
    regexError.value = ''
  } catch {
    regexError.value = t('settings.aiPreprocess.desensitizeRuleInvalidRegex')
    return
  }

  aiPreprocessConfig.value.desensitizeRules.push({
    id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    label: name,
    pattern,
    replacement,
    enabled: true,
    builtin: false,
    locales: [],
  })

  customForm.value = { name: '', pattern: '', replacement: '' }
}

function removeCustomRule(ruleId: string) {
  const idx = aiPreprocessConfig.value.desensitizeRules.findIndex((r) => r.id === ruleId)
  if (idx !== -1) aiPreprocessConfig.value.desensitizeRules.splice(idx, 1)
}
</script>

<template>
  <div class="space-y-6">
    <!-- 标题 -->
    <div>
      <h4 class="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-funnel" class="h-4 w-4 text-amber-500" />
        {{ t('settings.aiPreprocess.title') }}
      </h4>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        {{ t('settings.aiPreprocess.description') }}
      </p>
    </div>

    <!-- 开关项 -->
    <div class="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
      <!-- 数据清洗 -->
      <div class="flex items-center justify-between">
        <div class="flex-1 pr-4">
          <p class="text-sm font-medium text-gray-900 dark:text-white">
            {{ t('settings.aiPreprocess.dataCleaning') }}
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ t('settings.aiPreprocess.dataCleaningDesc') }}
          </p>
        </div>
        <USwitch v-model="aiPreprocessConfig.dataCleaning" />
      </div>

      <!-- 合并连续发言 -->
      <div class="flex items-center justify-between">
        <div class="flex-1 pr-4">
          <p class="text-sm font-medium text-gray-900 dark:text-white">
            {{ t('settings.aiPreprocess.mergeConsecutive') }}
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ t('settings.aiPreprocess.mergeConsecutiveDesc') }}
          </p>
        </div>
        <USwitch v-model="aiPreprocessConfig.mergeConsecutive" />
      </div>

      <!-- 合并时间窗口 -->
      <div v-if="aiPreprocessConfig.mergeConsecutive" class="ml-6 flex items-center justify-between">
        <p class="text-xs text-gray-500 dark:text-gray-400">
          {{ t('settings.aiPreprocess.mergeWindow') }}
        </p>
        <UInputNumber v-model="aiPreprocessConfig.mergeWindowSeconds" :min="30" :max="600" :step="30" class="w-28" />
      </div>

      <!-- 智能去噪 -->
      <div class="flex items-center justify-between">
        <div class="flex-1 pr-4">
          <p class="text-sm font-medium text-gray-900 dark:text-white">
            {{ t('settings.aiPreprocess.denoise') }}
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ t('settings.aiPreprocess.denoiseDesc') }}
          </p>
        </div>
        <USwitch v-model="aiPreprocessConfig.denoise" />
      </div>

      <!-- 昵称匿名化 -->
      <div class="flex items-center justify-between">
        <div class="flex-1 pr-4">
          <p class="text-sm font-medium text-gray-900 dark:text-white">
            {{ t('settings.aiPreprocess.anonymizeNames') }}
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ t('settings.aiPreprocess.anonymizeNamesDesc') }}
          </p>
        </div>
        <USwitch v-model="aiPreprocessConfig.anonymizeNames" />
      </div>

      <!-- 数据脱敏 -->
      <div class="flex items-center justify-between">
        <div class="flex-1 pr-4">
          <p class="text-sm font-medium text-gray-900 dark:text-white">
            {{ t('settings.aiPreprocess.desensitize') }}
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ t('settings.aiPreprocess.desensitizeDesc') }}
          </p>
        </div>
        <USwitch v-model="aiPreprocessConfig.desensitize" />
      </div>

      <!-- 脱敏规则列表（展开） -->
      <div v-if="aiPreprocessConfig.desensitize" class="ml-4 space-y-3">
        <!-- 预置规则 -->
        <div v-if="builtinRules.length > 0">
          <div class="mb-2 flex items-center justify-between gap-3">
            <p class="text-xs font-medium text-gray-500 dark:text-gray-400">
              {{ t('settings.aiPreprocess.desensitizeBuiltin') }}
            </p>
            <button
              type="button"
              class="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              @click="resetBuiltinRules"
            >
              <UIcon name="i-heroicons-arrow-path" class="h-3.5 w-3.5" />
              {{ t('settings.aiPreprocess.desensitizeResetBuiltin') }}
            </button>
          </div>
          <div class="space-y-2">
            <div
              v-for="group in builtinRuleGroups"
              :key="group.id"
              class="rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/40"
            >
              <div class="flex items-center gap-2 px-2.5 py-2">
                <UCheckbox
                  :model-value="getGroupState(group.rules).checked"
                  :indeterminate="getGroupState(group.rules).indeterminate"
                  size="xs"
                  @update:model-value="(value) => setGroupEnabled(group.rules, Boolean(value))"
                />
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-2 text-left"
                  @click="toggleGroupExpanded(group.id)"
                >
                  <UIcon
                    :name="isGroupExpanded(group.id) ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'"
                    class="h-3.5 w-3.5 shrink-0 text-gray-400"
                  />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-xs font-medium text-gray-700 dark:text-gray-200">
                      {{ getGroupLabel(group.id) }}
                    </span>
                    <span v-if="getGroupDesc(group.id)" class="block truncate text-[10px] text-gray-400">
                      {{ getGroupDesc(group.id) }}
                    </span>
                  </span>
                  <span class="shrink-0 text-[10px] text-gray-400">
                    {{ group.rules.filter((rule) => rule.enabled).length }}/{{ group.rules.length }}
                  </span>
                </button>
              </div>

              <div v-if="isGroupExpanded(group.id)" class="border-t border-gray-100 px-2 py-1.5 dark:border-gray-800">
                <label
                  v-for="rule in group.rules"
                  :key="rule.id"
                  class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700/50"
                >
                  <input
                    type="checkbox"
                    :checked="rule.enabled"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                    @change="toggleRule(rule.id)"
                  />
                  <span class="flex-1 text-xs text-gray-700 dark:text-gray-300">{{ getRuleLabel(rule) }}</span>
                  <span v-if="getRuleDesc(rule)" class="shrink-0 text-[10px] text-gray-400">
                    {{ getRuleDesc(rule) }}
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- 自定义规则 -->
        <div>
          <p class="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
            {{ t('settings.aiPreprocess.desensitizeCustom') }}
          </p>

          <!-- 已有自定义规则 -->
          <div v-if="customRules.length > 0" class="mb-2 space-y-1.5">
            <div
              v-for="rule in customRules"
              :key="rule.id"
              class="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700/50"
            >
              <input
                type="checkbox"
                :checked="rule.enabled"
                class="h-3.5 w-3.5 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                @change="toggleRule(rule.id)"
              />
              <span class="flex-1 text-xs text-gray-700 dark:text-gray-300">{{ rule.label }}</span>
              <code class="max-w-40 shrink-0 truncate text-[10px] text-gray-400" :title="rule.pattern">
                {{ rule.pattern }}
              </code>
              <UButton
                icon="i-heroicons-x-mark"
                variant="ghost"
                size="2xs"
                color="error"
                @click="removeCustomRule(rule.id)"
              />
            </div>
          </div>

          <!-- 添加自定义规则 -->
          <div class="space-y-3 rounded-md border border-dashed border-gray-300 p-3 dark:border-gray-600">
            <p class="text-xs font-medium text-gray-500 dark:text-gray-400">
              {{ t('settings.aiPreprocess.desensitizeAddCustom') }}
            </p>
            <div class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
              <label class="text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {{ t('settings.aiPreprocess.desensitizeRuleName') }}:
              </label>
              <UInput
                v-model="customForm.name"
                :placeholder="t('settings.aiPreprocess.desensitizeRuleNamePlaceholder')"
                size="xs"
                class="w-full"
              />
              <label class="text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {{ t('settings.aiPreprocess.desensitizeRulePattern') }}:
              </label>
              <div>
                <UInput
                  v-model="customForm.pattern"
                  :placeholder="t('settings.aiPreprocess.desensitizeRulePatternPlaceholder')"
                  size="xs"
                  class="w-full font-mono"
                />
                <p v-if="regexError" class="mt-1 text-xs text-red-500">{{ regexError }}</p>
              </div>
              <label class="text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {{ t('settings.aiPreprocess.desensitizeRuleReplacement') }}:
              </label>
              <UInput
                v-model="customForm.replacement"
                :placeholder="t('settings.aiPreprocess.desensitizeRuleReplacementPlaceholder')"
                size="xs"
                class="w-full"
              />
            </div>
            <UButton
              size="xs"
              variant="soft"
              block
              :disabled="!customForm.name.trim() || !customForm.pattern.trim() || !customForm.replacement.trim()"
              @click="addCustomRule"
            >
              {{ t('settings.aiPreprocess.desensitizeRuleAdd') }}
            </UButton>
          </div>
        </div>
      </div>
    </div>

    <!-- 黑名单关键词 -->
    <div>
      <h4 class="mb-2 text-sm font-medium text-gray-900 dark:text-white">
        {{ t('settings.aiPreprocess.blacklist') }}
      </h4>
      <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">
        {{ t('settings.aiPreprocess.blacklistDesc') }}
      </p>

      <!-- 输入区域 -->
      <div class="mb-3 flex gap-2">
        <UInput
          v-model="newKeyword"
          :placeholder="t('settings.aiPreprocess.blacklistPlaceholder')"
          class="flex-1"
          size="sm"
          @keydown.enter.prevent="addKeyword"
        />
        <UButton size="sm" variant="soft" :disabled="!newKeyword.trim()" @click="addKeyword">
          {{ t('settings.aiPreprocess.blacklistAdd') }}
        </UButton>
      </div>

      <!-- 关键词标签 -->
      <div v-if="aiPreprocessConfig.blacklistKeywords.length > 0" class="flex flex-wrap gap-2">
        <UBadge
          v-for="(kw, index) in aiPreprocessConfig.blacklistKeywords"
          :key="kw"
          variant="subtle"
          color="error"
          class="cursor-pointer"
          @click="removeKeyword(index)"
        >
          {{ kw }}
          <UIcon name="i-heroicons-x-mark" class="ml-1 h-3 w-3" />
        </UBadge>
      </div>
    </div>
  </div>
</template>
