<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import UITabs from '@/components/UI/Tabs.vue'
import { availableLocales, type LocaleType } from '@/i18n'

const emit = defineEmits<{
  (e: 'done'): void
}>()

const { t } = useI18n()
const settingsStore = useSettingsStore()

const LOCALE_SET_KEY = 'chatlab_locale_set_by_user'

const isOpen = ref(false)

const tabItems = computed(() =>
  availableLocales.map((l) => ({
    label: l.nativeName,
    value: l.code,
  }))
)

const currentLocale = computed({
  get: () => settingsStore.locale,
  set: (val: string | number) => settingsStore.setLocale(val as LocaleType),
})

onMounted(() => {
  const hasUserSetLocale = localStorage.getItem(LOCALE_SET_KEY)
  if (!hasUserSetLocale) {
    isOpen.value = true
  }
})

function handleNext() {
  localStorage.setItem(LOCALE_SET_KEY, 'true')
  isOpen.value = false
  emit('done')
}

/**
 * 是否因为已有语言设置而跳过了弹窗（供父组件判断流程）
 */
function wasSkipped(): boolean {
  return !!localStorage.getItem(LOCALE_SET_KEY)
}

defineExpose({ wasSkipped })
</script>

<template>
  <UModal
    :open="isOpen"
    prevent-close
    :ui="{
      content: 'sm:max-w-md',
      overlay: 'backdrop-blur-sm',
    }"
  >
    <template #content>
      <div class="language-select-modal flex flex-col p-6">
        <!-- Header -->
        <div class="mb-6 flex flex-col items-center text-center">
          <div
            class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-pink-100 to-rose-100 dark:from-pink-900/30 dark:to-rose-900/30"
          >
            <UIcon name="i-heroicons-language" class="h-7 w-7 text-pink-600 dark:text-pink-400" />
          </div>
          <h2 class="text-xl font-bold text-gray-900 dark:text-white">
            {{ t('common.languageSelect.title') }}
          </h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ t('common.languageSelect.subtitle') }}
          </p>
        </div>

        <!-- Language Tabs -->
        <div class="mb-6 flex justify-center">
          <UITabs v-model="currentLocale" size="md" :items="tabItems" />
        </div>

        <!-- Next Button -->
        <UButton
          block
          color="primary"
          size="lg"
          class="bg-pink-500 hover:bg-pink-600 dark:bg-pink-600 dark:hover:bg-pink-700"
          @click="handleNext"
        >
          {{ t('common.languageSelect.next') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.language-select-modal {
  -webkit-app-region: no-drag;
}
</style>
