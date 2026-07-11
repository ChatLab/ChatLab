<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import PageHeader from '@/components/layout/PageHeader.vue'
import PageNavigation from '@/components/navigation/PageNavigation.vue'
import { providePeoplePageHeader, type PeoplePageHeaderConfig, type PeopleSubpage } from './people-page-header'

const { t } = useI18n()
const route = useRoute()

const activeSubpage = computed<PeopleSubpage>(() =>
  route.name === 'people-relationships' ? 'relationships' : 'contacts'
)
const navigationItems = computed(() => [
  {
    id: 'contacts',
    label: t('contacts.title'),
    icon: 'i-lucide-users',
    to: { name: 'people-contacts' },
  },
  {
    id: 'relationships',
    label: t('relationships.title'),
    icon: 'i-lucide-git-fork',
    to: { name: 'people-relationships' },
  },
])

const defaultHeader = computed<PeoplePageHeaderConfig>(() =>
  activeSubpage.value === 'relationships'
    ? {
        title: t('layout.relationships'),
        description: t('relationships.subtitle'),
        icon: 'i-lucide-git-fork',
        iconClass: 'bg-primary-600 text-white dark:bg-primary-500 dark:text-white shadow-sm',
      }
    : {
        title: t('layout.relationships'),
        description: t('contacts.subtitle', { count: 0 }),
        icon: 'i-lucide-users',
        iconClass: 'bg-primary-600 text-white dark:bg-primary-500 dark:text-white shadow-sm',
      }
)

const { header } = providePeoplePageHeader(defaultHeader)
</script>

<template>
  <div
    class="flex h-full flex-col text-gray-900 dark:bg-page-dark dark:text-gray-100"
    style="padding-top: var(--titlebar-area-height)"
  >
    <PageHeader
      :title="header.title"
      :description="header.description"
      size="compact"
      :icon="header.icon"
      :icon-class="header.iconClass"
    >
      <template #actions>
        <UButton
          v-if="header.action"
          :icon="header.action.icon"
          color="primary"
          variant="soft"
          size="sm"
          class="rounded-xl"
          :class="header.action.class"
          :loading="header.action.loading"
          :disabled="header.action.disabled"
          @click="header.action.onClick"
        >
          {{ header.action.label }}
        </UButton>
      </template>

      <PageNavigation
        class="mt-3 pb-1.5"
        :model-value="activeSubpage"
        :items="navigationItems"
        :aria-label="t('relationships.nav')"
      >
        <template #right>
          <div v-if="header.stats?.length" class="hidden items-center gap-5 text-[11px] sm:flex">
            <template v-for="stat in header.stats" :key="stat.id">
              <div v-if="stat.dividerBefore" class="h-3 w-px bg-gray-250 dark:bg-white/10"></div>
              <div class="flex items-center gap-1.5">
                <span class="text-gray-400 dark:text-gray-500">{{ stat.label }}</span>
                <span class="font-mono font-bold text-gray-900 dark:text-white">{{ stat.value }}</span>
              </div>
            </template>
          </div>
        </template>
      </PageNavigation>
    </PageHeader>

    <RouterView v-slot="{ Component }">
      <Transition name="people-tab-slide" mode="out-in">
        <component :is="Component" :key="activeSubpage" />
      </Transition>
    </RouterView>
  </div>
</template>

<style scoped>
.people-tab-slide-enter-active,
.people-tab-slide-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.people-tab-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.people-tab-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
