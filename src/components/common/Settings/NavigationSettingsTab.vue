<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { NavigationLayout, NavigationLayoutGroupItem } from '@openchatlab/shared-types'
import { UiBadge, UiButton, UiIcon, UiIconButton } from '@/components/UI/primitives'
import { useToast } from '@/composables/useToast'
import {
  canWriteNavigationLayout,
  createDefaultNavigationLayout,
  createEditableNavigationLayout,
  DEFAULT_INSIGHT_NAVIGATION_GROUP_ID,
  moveGroupedNavigationEntry,
  moveHiddenNavigationEntry,
  movePrimaryNavigationItem,
  placeNavigationEntry,
} from '@/navigation/layout'
import { redirectFromHiddenInsightPage } from '@/navigation/router'
import { useNavigationLayout } from '@/navigation/vue'
import { useHostLocale, useInsightPluginRuntime } from '@/plugins/insight-vue'
import { listInsightShellNavigation } from '@/plugins/insight-catalog'
import { useNavigationLayoutService } from '@/services'
import { reportError } from '@/services/log-report'

const { t } = useI18n()
const { translate } = useHostLocale()
const router = useRouter()
const toast = useToast()
const runtime = useInsightPluginRuntime()
const { controller, snapshot } = useNavigationLayout()
const service = useNavigationLayoutService()
const availableEntries = new Map(listInsightShellNavigation(runtime).map((entry) => [entry.entryId, entry.page]))

const draft = ref(createEditableNavigationLayout(runtime, controller.getSnapshot().layout))
const baseline = ref(serializeLayout(draft.value))
const isSaving = ref(false)
const isResetting = ref(false)
const hasChanges = computed(() => serializeLayout(draft.value) !== baseline.value)
const loadSource = computed(() => snapshot.value.source)
const canWriteLayout = computed(() => canWriteNavigationLayout(loadSource.value))

const groups = computed(() => draft.value.primary.filter((item) => item.kind === 'group'))

function serializeLayout(layout: NavigationLayout): string {
  return JSON.stringify(layout)
}

function groupTitle(group: NavigationLayoutGroupItem): string {
  if (group.title) return group.title
  return group.id === DEFAULT_INSIGHT_NAVIGATION_GROUP_ID ? t('layout.insight') : group.id
}

function entryTitle(entryId: string): string {
  const page = availableEntries.get(entryId)
  return page ? translate(page.title) : entryId
}

function entryIcon(entryId: string): string {
  return availableEntries.get(entryId)?.icon ?? 'i-heroicons-puzzle-piece'
}

function destinationOptions() {
  const targetGroups = [...groups.value]
  if (!targetGroups.some(({ id }) => id === DEFAULT_INSIGHT_NAVIGATION_GROUP_ID)) {
    targetGroups.push({ kind: 'group', id: DEFAULT_INSIGHT_NAVIGATION_GROUP_ID, children: [] })
  }
  return [
    { label: t('settings.navigation.primary'), value: 'primary' },
    ...targetGroups.map((group) => ({
      label: t('settings.navigation.inGroup', { group: groupTitle(group) }),
      value: `group:${group.id}`,
    })),
    { label: t('settings.navigation.hidden'), value: 'hidden' },
  ]
}

function destinationValue(entryId: string): string {
  if (draft.value.hiddenEntryIds.includes(entryId)) return 'hidden'
  for (const item of draft.value.primary) {
    if (item.kind === 'entry' && item.entryId === entryId) return 'primary'
    if (item.kind === 'group' && item.children.includes(entryId)) return `group:${item.id}`
  }
  return 'hidden'
}

function updateDestination(entryId: string, value: unknown): void {
  if (value === 'primary' || value === 'hidden') {
    draft.value = placeNavigationEntry(draft.value, entryId, { kind: value })
    return
  }
  if (typeof value === 'string' && value.startsWith('group:')) {
    draft.value = placeNavigationEntry(draft.value, entryId, { kind: 'group', groupId: value.slice(6) })
  }
}

function movePrimary(index: number, offset: -1 | 1): void {
  draft.value = movePrimaryNavigationItem(draft.value, index, offset)
}

function moveGrouped(groupId: string, index: number, offset: -1 | 1): void {
  draft.value = moveGroupedNavigationEntry(draft.value, groupId, index, offset)
}

function moveHidden(index: number, offset: -1 | 1): void {
  draft.value = moveHiddenNavigationEntry(draft.value, index, offset)
}

async function save(): Promise<void> {
  if (!canWriteLayout.value || !hasChanges.value || isSaving.value) return
  isSaving.value = true
  try {
    const result = await service.save(draft.value)
    controller.applySavedLayout(result.layout)
    draft.value = createEditableNavigationLayout(runtime, result.layout)
    baseline.value = serializeLayout(draft.value)
    await redirectFromHiddenInsightPage(router, controller)
    toast.success(t('settings.navigation.saved'))
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    reportError(`Navigation layout save failed: ${normalized.message}`, normalized.stack)
    toast.fail(t('settings.navigation.saveFailed'))
  } finally {
    isSaving.value = false
  }
}

async function reset(): Promise<void> {
  if (!canWriteLayout.value || isResetting.value) return
  isResetting.value = true
  try {
    await service.reset()
    controller.applyDefaultLayout()
    draft.value = createDefaultNavigationLayout(runtime)
    baseline.value = serializeLayout(draft.value)
    await redirectFromHiddenInsightPage(router, controller)
    toast.success(t('settings.navigation.resetDone'))
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    reportError(`Navigation layout reset failed: ${normalized.message}`, normalized.stack)
    toast.fail(t('settings.navigation.resetFailed'))
  } finally {
    isResetting.value = false
  }
}
</script>

<template>
  <div class="space-y-5 pb-6">
    <div>
      <h3 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UiIcon name="i-heroicons-bars-3-bottom-left" size="sm" class="text-primary-500" />
        {{ t('settings.navigation.title') }}
      </h3>
      <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
        {{ t('settings.navigation.description') }}
      </p>
    </div>

    <div
      v-if="loadSource === 'invalid'"
      class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
    >
      {{ t('settings.navigation.invalidLayout') }}
    </div>

    <div
      v-else-if="loadSource === 'failed'"
      class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
    >
      {{ t('settings.navigation.loadFailed') }}
    </div>

    <div class="space-y-3">
      <div
        v-for="(item, primaryIndex) in draft.primary"
        :key="`${item.kind}:${item.kind === 'entry' ? item.entryId : item.id}`"
        class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50"
      >
        <div class="flex items-center gap-3 p-3">
          <UiIcon
            :name="item.kind === 'entry' ? entryIcon(item.entryId) : 'i-heroicons-folder'"
            size="sm"
            class="shrink-0 text-gray-500"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-gray-900 dark:text-white">
              {{ item.kind === 'entry' ? entryTitle(item.entryId) : groupTitle(item) }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ item.kind === 'entry' ? t('settings.navigation.primary') : t('settings.navigation.group') }}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <UiIconButton
              icon="i-heroicons-chevron-up"
              :label="t('settings.navigation.moveUp')"
              :disabled="primaryIndex === 0"
              @click="movePrimary(primaryIndex, -1)"
            />
            <UiIconButton
              icon="i-heroicons-chevron-down"
              :label="t('settings.navigation.moveDown')"
              :disabled="primaryIndex === draft.primary.length - 1"
              @click="movePrimary(primaryIndex, 1)"
            />
            <USelect
              v-if="item.kind === 'entry'"
              :model-value="destinationValue(item.entryId)"
              :items="destinationOptions()"
              :ui="{ content: 'z-[200]' }"
              size="sm"
              class="w-40"
              :aria-label="t('settings.navigation.locationFor', { title: entryTitle(item.entryId) })"
              @update:model-value="updateDestination(item.entryId, $event)"
            />
          </div>
        </div>

        <div v-if="item.kind === 'group'" class="border-t border-gray-200 dark:border-gray-700">
          <div
            v-for="(entryId, childIndex) in item.children"
            :key="entryId"
            class="flex items-center gap-3 border-b border-gray-200 px-3 py-2.5 last:border-b-0 dark:border-gray-700"
          >
            <UiIcon :name="entryIcon(entryId)" size="sm" class="ml-4 shrink-0 text-gray-500" />
            <p class="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-200">
              {{ entryTitle(entryId) }}
            </p>
            <UiBadge
              v-if="!availableEntries.has(entryId)"
              :label="t('settings.navigation.unavailable')"
              size="xs"
              tone="warning"
            />
            <UiIconButton
              icon="i-heroicons-chevron-up"
              :label="t('settings.navigation.moveUp')"
              :disabled="childIndex === 0"
              @click="moveGrouped(item.id, childIndex, -1)"
            />
            <UiIconButton
              icon="i-heroicons-chevron-down"
              :label="t('settings.navigation.moveDown')"
              :disabled="childIndex === item.children.length - 1"
              @click="moveGrouped(item.id, childIndex, 1)"
            />
            <USelect
              :model-value="destinationValue(entryId)"
              :items="destinationOptions()"
              :ui="{ content: 'z-[200]' }"
              size="sm"
              class="w-40"
              :aria-label="t('settings.navigation.locationFor', { title: entryTitle(entryId) })"
              @update:model-value="updateDestination(entryId, $event)"
            />
          </div>
          <p v-if="item.children.length === 0" class="px-4 py-3 text-xs text-gray-400">
            {{ t('settings.navigation.emptyGroup') }}
          </p>
        </div>
      </div>
    </div>

    <div
      v-if="draft.hiddenEntryIds.length > 0"
      class="rounded-lg border border-dashed border-gray-300 dark:border-gray-700"
    >
      <div class="flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">
        <UiIcon name="i-heroicons-eye-slash" size="sm" />
        {{ t('settings.navigation.hidden') }}
      </div>
      <div
        v-for="(entryId, hiddenIndex) in draft.hiddenEntryIds"
        :key="entryId"
        class="flex items-center gap-3 border-t border-gray-200 px-3 py-2.5 dark:border-gray-700"
      >
        <UiIcon :name="entryIcon(entryId)" size="sm" class="shrink-0 text-gray-400" />
        <p class="min-w-0 flex-1 truncate text-sm text-gray-600 dark:text-gray-300">
          {{ entryTitle(entryId) }}
        </p>
        <UiBadge
          v-if="!availableEntries.has(entryId)"
          :label="t('settings.navigation.unavailable')"
          size="xs"
          tone="warning"
        />
        <UiIconButton
          icon="i-heroicons-chevron-up"
          :label="t('settings.navigation.moveUp')"
          :disabled="hiddenIndex === 0"
          @click="moveHidden(hiddenIndex, -1)"
        />
        <UiIconButton
          icon="i-heroicons-chevron-down"
          :label="t('settings.navigation.moveDown')"
          :disabled="hiddenIndex === draft.hiddenEntryIds.length - 1"
          @click="moveHidden(hiddenIndex, 1)"
        />
        <USelect
          :model-value="destinationValue(entryId)"
          :items="destinationOptions()"
          :ui="{ content: 'z-[200]' }"
          size="sm"
          class="w-40"
          :aria-label="t('settings.navigation.locationFor', { title: entryTitle(entryId) })"
          @update:model-value="updateDestination(entryId, $event)"
        />
      </div>
    </div>

    <div class="flex items-center justify-between border-t border-gray-200 pt-4 dark:border-gray-800">
      <p class="text-xs text-gray-500 dark:text-gray-400">
        {{ t('settings.navigation.storageHint') }}
      </p>
      <div class="flex items-center gap-2">
        <UiButton
          :label="t('settings.navigation.reset')"
          tone="neutral"
          variant="soft"
          size="sm"
          :loading="isResetting"
          :disabled="!canWriteLayout || isSaving"
          @click="reset"
        />
        <UiButton
          :label="t('common.save')"
          size="sm"
          :loading="isSaving"
          :disabled="!canWriteLayout || !hasChanges || isResetting"
          @click="save"
        />
      </div>
    </div>
  </div>
</template>
