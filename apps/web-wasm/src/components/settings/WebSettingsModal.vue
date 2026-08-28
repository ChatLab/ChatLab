<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import BasicSettingsTab from '@/components/common/Settings/BasicSettingsTab.vue'
import SettingsDialogShell from '@/components/common/Settings/SettingsDialogShell.vue'
import { useLayoutStore } from '@/stores/layout'

const { t } = useI18n()
const layoutStore = useLayoutStore()
const { showSettings } = storeToRefs(layoutStore)
const activeTab = ref('settings')
const tabs = computed(() => [{ id: 'settings', label: t('settings.tabs.basic'), icon: 'i-heroicons-cog-6-tooth' }])

watch(showSettings, (visible) => {
  if (!visible) return
  activeTab.value = 'settings'
})
</script>

<template>
  <SettingsDialogShell v-model:open="showSettings" v-model:active-tab="activeTab" :tabs="tabs">
    <BasicSettingsTab :show-default-session-tab="false" :show-tools-panel="false" />
  </SettingsDialogShell>
</template>
