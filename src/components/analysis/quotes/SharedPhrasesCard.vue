<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ThemeCard, LoadingState } from '@/components/UI'
import { useDataService } from '@/services'
import { useLayoutStore } from '@/stores/layout'
import { formatDate, formatDateTime } from '@/utils/dateFormat'
import type { SharedPhrasesResult } from '@/types/quotes/sharedPhrases'
import type { TimeFilter } from '@openchatlab/shared-types'

const props = withDefaults(
  defineProps<{
    sessionId: string
    timeFilter?: TimeFilter
    enableRecordNavigation?: boolean
  }>(),
  { enableRecordNavigation: true }
)

const { t } = useI18n()
const layoutStore = useLayoutStore()

const result = ref<SharedPhrasesResult | null>(null)
const isLoading = ref(false)
const expandedPhrases = ref(new Set<string>())

const data = computed(() => (result.value?.available ? result.value : null))
const memberNames = computed(() => new Map(data.value?.participants.map((item) => [item.memberId, item.name] as const)))
const exampleMessages = computed(() => new Map(data.value?.exampleMessages.map((item) => [item.id, item] as const)))

let requestId = 0
async function loadSharedPhrases() {
  if (!props.sessionId) return
  const currentRequest = ++requestId
  isLoading.value = true
  try {
    const timeFilter = props.timeFilter
      ? { startTs: props.timeFilter.startTs, endTs: props.timeFilter.endTs }
      : undefined
    const loaded = await useDataService().getSharedPhrases(props.sessionId, timeFilter)
    if (currentRequest !== requestId) return
    result.value = loaded
    expandedPhrases.value = new Set()
  } catch (error) {
    console.error('Failed to load shared phrases:', error)
    if (currentRequest === requestId) result.value = null
  } finally {
    if (currentRequest === requestId) isLoading.value = false
  }
}

function togglePhrase(phrase: string) {
  const next = new Set(expandedPhrases.value)
  if (next.has(phrase)) next.delete(phrase)
  else next.add(phrase)
  expandedPhrases.value = next
}

function openMessage(messageId: number) {
  if (!props.enableRecordNavigation) return
  layoutStore.openChatRecordDrawer({ scrollToMessageId: messageId })
}

watch(
  () => props.sessionId,
  () => {
    result.value = null
  }
)

watch(
  () => [props.sessionId, props.timeFilter],
  () => {
    loadSharedPhrases()
  },
  { immediate: true, deep: true }
)
</script>

<template>
  <ThemeCard v-if="isLoading || result">
    <div class="px-5 py-4 sm:px-6">
      <div class="mb-1 flex items-center gap-2">
        <UIcon name="i-heroicons-chat-bubble-left-right" class="h-4 w-4 text-sky-500" />
        <span class="text-[15px] font-black tracking-tight text-gray-900 dark:text-white">
          {{ t('quotes.sharedPhrases.title') }}
        </span>
      </div>
      <p class="mb-4 text-xs text-gray-500 dark:text-gray-400">{{ t('quotes.sharedPhrases.description') }}</p>

      <LoadingState v-if="!result" />
      <p v-else-if="!data" class="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
        {{ t('quotes.sharedPhrases.unavailable') }}
      </p>
      <template v-else>
        <p v-if="data.phrases.length === 0" class="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
          {{ t('quotes.sharedPhrases.empty') }}
        </p>
        <ul
          v-else
          class="max-h-[520px] divide-y divide-gray-100 overflow-y-auto pr-1 dark:divide-white/5"
          :class="{ 'opacity-60': isLoading }"
        >
          <li v-for="item in data.phrases" :key="item.phrase" class="py-2.5">
            <button
              type="button"
              class="flex w-full items-start justify-between gap-3 text-left"
              :aria-expanded="expandedPhrases.has(item.phrase)"
              @click="togglePhrase(item.phrase)"
            >
              <div class="min-w-0">
                <p class="break-words text-sm font-bold text-gray-900 dark:text-white">{{ item.phrase }}</p>
                <div class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                  <span v-for="use in item.members" :key="use.memberId">
                    <span class="font-medium text-gray-700 dark:text-gray-300">
                      {{ memberNames.get(use.memberId) }}
                    </span>
                    · {{ t('quotes.sharedPhrases.turns', { count: use.turns }) }} ·
                    {{ t('quotes.sharedPhrases.firstUsed', { date: formatDate(use.firstTs) }) }}
                  </span>
                </div>
              </div>
              <UIcon
                :name="expandedPhrases.has(item.phrase) ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'"
                class="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
              />
            </button>

            <div v-if="expandedPhrases.has(item.phrase)" class="mt-2 space-y-2">
              <div v-for="use in item.members" :key="use.memberId">
                <p class="px-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                  {{ memberNames.get(use.memberId) }}
                </p>
                <component
                  :is="props.enableRecordNavigation ? 'button' : 'div'"
                  v-for="messageId in use.exampleMessageIds"
                  :key="messageId"
                  :type="props.enableRecordNavigation ? 'button' : undefined"
                  :title="exampleMessages.get(messageId)?.content"
                  class="block w-full rounded-md px-2 py-1 text-left text-xs text-gray-700 dark:text-gray-300"
                  :class="{ 'hover:bg-gray-100 dark:hover:bg-white/5': props.enableRecordNavigation }"
                  @click="openMessage(messageId)"
                >
                  <!-- Long messages are clamped here; the title and the record drawer show the whole text. -->
                  <span class="line-clamp-3 break-words">
                    <span class="mr-2 text-gray-400 dark:text-gray-500">
                      {{ formatDateTime(exampleMessages.get(messageId)?.ts ?? use.firstTs) }}
                    </span>
                    {{ exampleMessages.get(messageId)?.content }}
                  </span>
                </component>
              </div>
            </div>
          </li>
        </ul>

        <div
          class="mt-4 space-y-0.5 border-t border-gray-100 pt-3 text-[11px] text-gray-400 dark:border-white/5 dark:text-gray-500"
        >
          <p v-if="data.hasMore">{{ t('quotes.sharedPhrases.hasMore', { count: data.phrases.length }) }}</p>
          <p>
            {{
              t('quotes.sharedPhrases.coverage', {
                text: data.coverage.textMessages,
                excluded: data.coverage.excludedMessages,
                turns: data.coverage.turns,
                sessions: data.coverage.sessions,
              })
            }}
          </p>
          <p>
            {{
              t('quotes.sharedPhrases.method', {
                tokenizer: data.rule.tokenizer,
                rule: `${data.rule.version}, ${data.rule.turnRuleVersion}`,
              })
            }}
          </p>
        </div>
      </template>
    </div>
  </ThemeCard>
</template>
