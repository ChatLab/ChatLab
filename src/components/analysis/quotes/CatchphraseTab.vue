<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CatchphraseAnalysis, MemberCatchphrase } from '@/types/analysis'
import { useDataService } from '@/services'
import { ListPro } from '@/components/charts'
import { EmptyState, LoadingState, SectionCard } from '@/components/UI'
import { useLayoutStore } from '@/stores/layout'
import { formatRankNumber, getRankNumberClass } from '@/utils'
import type { TimeFilter } from '@openchatlab/shared-types'

const { t } = useI18n()
const layoutStore = useLayoutStore()

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const catchphraseAnalysis = ref<CatchphraseAnalysis | null>(null)
const isLoading = ref(false)

const members = computed(() => catchphraseAnalysis.value?.members ?? [])
const isMemberView = computed(() => props.timeFilter?.memberId != null)
const selectedMember = computed(() => (isMemberView.value ? (members.value[0] ?? null) : null))
const cardTitle = computed(() =>
  selectedMember.value
    ? t('quotes.catchphrase.memberTitle', { name: selectedMember.value.name })
    : t('quotes.catchphrase.title')
)
const cardDescription = computed(() =>
  isMemberView.value ? t('quotes.catchphrase.memberDescription') : t('quotes.catchphrase.description')
)

async function loadCatchphraseAnalysis() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    catchphraseAnalysis.value = await useDataService().getCatchphraseAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('Failed to load catchphrase analysis:', error)
  } finally {
    isLoading.value = false
  }
}

function handlePhraseClick(content: string) {
  layoutStore.openChatRecordDrawer({
    keywords: [content],
  })
}

function getOverviewPhrases(member: MemberCatchphrase) {
  return member.catchphrases.slice(0, 5)
}

watch(
  () => [props.sessionId, props.timeFilter],
  () => {
    loadCatchphraseAnalysis()
  },
  { immediate: true, deep: true }
)
</script>

<template>
  <div class="main-content mx-auto max-w-3xl p-6">
    <LoadingState v-if="isLoading" :text="t('quotes.catchphrase.loading')" />

    <ListPro
      v-else-if="selectedMember"
      :items="selectedMember.catchphrases"
      :title="cardTitle"
      :description="cardDescription"
      :top-n="10"
      :count-label="t('quotes.catchphrase.phraseCount', { count: selectedMember.catchphrases.length })"
    >
      <template #item="{ item, index }">
        <button
          type="button"
          class="group/item grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
          :aria-label="`${t('quotes.catchphrase.viewChat')}: ${item.content}`"
          @click="handlePhraseClick(item.content)"
        >
          <span
            class="w-8 shrink-0 text-center font-mono text-sm font-black tabular-nums"
            :class="getRankNumberClass(index)"
          >
            {{ formatRankNumber(index) }}
          </span>
          <p
            class="line-clamp-2 min-w-0 text-sm font-medium leading-5 text-gray-900 dark:text-white"
            :title="item.content"
          >
            {{ item.content }}
          </p>
          <div class="flex shrink-0 items-center gap-3 pl-2">
            <span class="font-mono text-sm font-black tabular-nums text-primary-600 dark:text-primary-400">
              {{ t('quotes.catchphrase.times', { count: item.count }) }}
            </span>
            <UIcon
              name="i-heroicons-chevron-right"
              class="h-4 w-4 text-gray-300 transition-colors group-hover/item:text-gray-500 dark:text-gray-600 dark:group-hover/item:text-gray-400"
            />
          </div>
        </button>
      </template>
    </ListPro>

    <ListPro
      v-else-if="members.length > 0"
      :items="members"
      :title="cardTitle"
      :description="cardDescription"
      :top-n="10"
      :count-label="t('quotes.catchphrase.memberCount', { count: members.length })"
    >
      <template #item="{ item: member, index }">
        <div
          class="grid w-full grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 sm:grid-cols-[2rem_minmax(7.5rem,0.65fr)_minmax(0,1.35fr)]"
        >
          <span
            class="row-span-2 w-8 shrink-0 pt-0.5 text-center font-mono text-sm font-black tabular-nums sm:row-span-1"
            :class="getRankNumberClass(index)"
          >
            {{ formatRankNumber(index) }}
          </span>

          <p
            class="col-start-2 row-start-1 min-w-0 truncate pt-0.5 text-sm font-semibold text-gray-900 dark:text-white"
            :title="member.name"
          >
            {{ member.name }}
          </p>

          <div
            class="col-start-2 row-start-2 mt-1.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 sm:col-start-3 sm:row-start-1 sm:mt-0"
          >
            <button
              v-for="phrase in getOverviewPhrases(member)"
              :key="phrase.content"
              type="button"
              class="group/phrase inline-flex max-w-full items-baseline gap-1 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
              :title="phrase.content"
              :aria-label="`${t('quotes.catchphrase.viewChat')}: ${phrase.content}`"
              @click="handlePhraseClick(phrase.content)"
            >
              <span
                class="max-w-40 truncate text-sm text-gray-700 transition-colors group-hover/phrase:text-primary-600 dark:text-gray-200 dark:group-hover/phrase:text-primary-400"
              >
                “{{ phrase.content }}”
              </span>
              <span class="shrink-0 font-mono text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                {{ t('quotes.catchphrase.times', { count: phrase.count }) }}
              </span>
            </button>
          </div>
        </div>
      </template>
    </ListPro>

    <SectionCard v-else :title="cardTitle" :description="cardDescription" :show-divider="false">
      <EmptyState :text="t('quotes.catchphrase.empty.title')" />
    </SectionCard>
  </div>
</template>
