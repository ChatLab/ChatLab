<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import SidebarButton from './SidebarButton.vue'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()

const isSettingsPage = computed(() => route.name === 'settings')
</script>

<template>
  <div class="px-4 py-2 dark:border-gray-800 space-y-2 mb-2">
    <!-- 设置 -->
    <SidebarButton
      icon="i-heroicons-cog-6-tooth"
      :title="t('layout.footer.settings')"
      :active="isSettingsPage"
      @click="router.push({ name: 'settings' })"
    />
  </div>
</template>
