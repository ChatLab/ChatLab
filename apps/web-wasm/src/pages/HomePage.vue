<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDark, useToggle } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import logoSvg from '@/assets/images/logo.svg'
import AgreementModal from '@/components/home/AgreementModal.vue'
import HomeFooter from '@/components/home/HomeFooter.vue'
import ImportArea from '@/components/import/ImportArea.vue'
import { availableLocales, type LocaleType } from '@/i18n'
import { useSettingsStore } from '@/stores/settings'
import { useSessionStore } from '@/stores/session'
import { getChatlabSiteLocalePath } from '@/utils/chatlabSiteLocale'

const { t, locale } = useI18n()
const settingsStore = useSettingsStore()
const sessionStore = useSessionStore()
const { sessions } = storeToRefs(sessionStore)
const isMounted = ref(false)
const languageMenuOpen = ref(false)
const agreementModalRef = ref<InstanceType<typeof AgreementModal> | null>(null)
const isDark = useDark()
const toggleDark = useToggle(isDark)

async function selectLocale(localeCode: LocaleType) {
  await settingsStore.setLocale(localeCode)
  languageMenuOpen.value = false
}

const tutorialExportUrl = computed(() => {
  const localePath = getChatlabSiteLocalePath(locale.value)
  const langPath = localePath === 'cn' || localePath === 'tw' ? `/${localePath}/` : '/'
  return `https://docs.chatlab.fun${langPath}`
})

onMounted(() => {
  requestAnimationFrame(() => {
    // Web WASM 会在异步初始化完成后才挂载首页，多等待一帧，确保初始透明态先完成绘制。
    requestAnimationFrame(() => {
      isMounted.value = true
    })
  })
})
</script>

<template>
  <div class="relative flex h-full w-full overflow-hidden">
    <div class="relative flex h-full w-full flex-col overflow-y-auto">
      <header
        class="mx-auto flex w-full max-w-6xl flex-none items-center gap-3 px-4 py-4 sm:px-6 sm:py-5"
        :class="sessions.length > 0 ? 'justify-end' : 'justify-between'"
      >
        <div v-if="sessions.length === 0" class="flex select-none items-center gap-2.5">
          <img :src="logoSvg" alt="" class="pointer-events-none h-8 w-8 select-none" />
          <span class="text-base font-semibold tracking-tight text-gray-900 dark:text-white">ChatLab</span>
        </div>
        <div class="flex items-center gap-1">
          <UPopover v-model:open="languageMenuOpen" :ui="{ content: 'p-1.5' }">
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white"
              :aria-label="t('common.languageSelect.title')"
              :title="t('common.languageSelect.title')"
              aria-haspopup="menu"
            >
              <UIcon name="i-heroicons-language" class="h-4 w-4" />
            </button>

            <template #content>
              <div class="min-w-36" role="menu" :aria-label="t('common.languageSelect.title')">
                <button
                  v-for="option in availableLocales"
                  :key="option.code"
                  type="button"
                  role="menuitemradio"
                  :aria-checked="settingsStore.locale === option.code"
                  class="flex w-full items-center justify-between gap-4 rounded-md px-2.5 py-2 text-left text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-white"
                  @click="selectLocale(option.code as LocaleType)"
                >
                  <span>{{ option.nativeName }}</span>
                  <UIcon
                    v-if="settingsStore.locale === option.code"
                    name="i-heroicons-check-20-solid"
                    class="h-4 w-4 text-primary-500"
                  />
                </button>
              </div>
            </template>
          </UPopover>

          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white"
            :aria-label="t(isDark ? 'settings.basic.appearance.light' : 'settings.basic.appearance.dark')"
            :title="t(isDark ? 'settings.basic.appearance.light' : 'settings.basic.appearance.dark')"
            @click="toggleDark()"
          >
            <UIcon :name="isDark ? 'i-heroicons-sun' : 'i-heroicons-moon'" class="h-4 w-4" />
          </button>
        </div>
      </header>

      <main
        class="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-8"
      >
        <section class="w-full text-center" aria-labelledby="web-wasm-home-title">
          <div
            class="landing-reveal transition-all duration-500 ease-out"
            :class="isMounted ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'"
          >
            <h1
              id="web-wasm-home-title"
              class="landing-title mx-auto max-w-3xl text-[2.15rem] font-semibold leading-[1.08] tracking-[-0.035em] text-gray-950 sm:text-5xl lg:text-[3.25rem] dark:text-white"
            >
              {{ t('browser.title') }}
            </h1>
            <p class="mx-auto mt-4 max-w-xl text-sm leading-6 text-gray-500 dark:text-gray-400">
              {{ t('browser.subtitle') }}
            </p>
            <div class="mt-4 flex flex-wrap items-center justify-center gap-2" role="list">
              <span
                class="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
                role="listitem"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true"></span>
                {{ t('browser.noSignIn') }}
              </span>
              <span
                class="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
                role="listitem"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true"></span>
                {{ t('browser.localOnly') }}
              </span>
              <span
                class="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
                role="listitem"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true"></span>
                {{ t('browser.noUpload') }}
              </span>
            </div>
          </div>

          <div
            class="landing-reveal mt-10 w-full transition-all delay-100 duration-500 ease-out"
            :class="isMounted ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'"
          >
            <ImportArea :backend-features="false" />
          </div>

          <div
            class="landing-reveal mt-4 flex justify-center transition-all delay-200 duration-500 ease-out"
            :class="isMounted ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'"
          >
            <UButton
              :href="tutorialExportUrl"
              target="_blank"
              color="neutral"
              variant="link"
              size="sm"
              trailing-icon="i-heroicons-arrow-up-right-20-solid"
            >
              {{ t('browser.exportGuide') }}
            </UButton>
          </div>
        </section>
      </main>

      <HomeFooter :remote-config-enabled="false" :show-changelog="false" @open-terms="agreementModalRef?.open()" />
    </div>

    <AgreementModal ref="agreementModalRef" />
  </div>
</template>

<style scoped>
.landing-title {
  font-family: 'Iowan Old Style', 'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Noto Serif SC', serif;
}

@media (prefers-reduced-motion: reduce) {
  .landing-reveal {
    transition-duration: 0.01ms !important;
    transition-delay: 0ms !important;
    transform: none !important;
  }
}
</style>
