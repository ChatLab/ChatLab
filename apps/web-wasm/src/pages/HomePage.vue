<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import logoSvg from '@/assets/images/logo.svg'
import AgreementModal from '@/components/home/AgreementModal.vue'
import ChangelogModal from '@/components/home/ChangelogModal.vue'
import HomeFooter from '@/components/home/HomeFooter.vue'
import ImportArea from '@/components/import/ImportArea.vue'
import LanguageSelectModal from '@/components/home/LanguageSelectModal.vue'
import { getChatlabSiteLocalePath } from '@/utils/chatlabSiteLocale'

const { t, locale } = useI18n()
const isMounted = ref(false)
const changelogModalRef = ref<InstanceType<typeof ChangelogModal> | null>(null)
const agreementModalRef = ref<InstanceType<typeof AgreementModal> | null>(null)

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
  <div class="relative flex h-full w-full overflow-hidden pt-4">
    <div class="relative h-full w-full overflow-y-auto">
      <div class="flex min-h-full w-full flex-col items-center justify-center px-4 py-12">
        <div
          class="relative mb-4 flex select-none items-center justify-center gap-4 transition-all duration-700 ease-out xl:mb-6"
          :class="isMounted ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'"
        >
          <img :src="logoSvg" alt="ChatLab" class="pointer-events-none h-10 w-10 select-none" />
          <h1 class="text-3xl font-bold leading-none tracking-tight text-gray-900 dark:text-white">
            {{ t('home.tagline') }}
          </h1>
        </div>

        <div
          class="w-full transition-all delay-200 duration-700 ease-out"
          :class="isMounted ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'"
        >
          <ImportArea :backend-features="false" />
        </div>

        <div
          class="mt-6 flex items-center gap-3 transition-all delay-300 duration-700 ease-out"
          :class="isMounted ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'"
        >
          <UButton :href="tutorialExportUrl" target="_blank" trailing-icon="i-heroicons-chevron-right-20-solid">
            {{ t('home.quickStart.export') }}
          </UButton>
        </div>
      </div>

      <HomeFooter
        :remote-config-enabled="false"
        @open-changelog="changelogModalRef?.open()"
        @open-terms="agreementModalRef?.open()"
      />
    </div>

    <!--
      Web WASM intentionally does not gate its fully local import flow on agreement acceptance.
      Keep the agreement available from HomeFooter only; do not open it from LanguageSelectModal's done event.
    -->
    <LanguageSelectModal />
    <AgreementModal ref="agreementModalRef" />
    <ChangelogModal ref="changelogModalRef" />
  </div>
</template>
