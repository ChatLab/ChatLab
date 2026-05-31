<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { configureHttpClient } from '@/services/utils/http'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const tokenInput = ref('')
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  const trimmed = tokenInput.value.trim()
  if (!trimmed) {
    error.value = t('common.login.errorEmpty')
    return
  }

  loading.value = true
  error.value = ''

  try {
    const resp = await fetch('/api/v1/status', {
      headers: { Authorization: `Bearer ${trimmed}` },
    })

    if (!resp.ok) {
      error.value = t('common.login.errorInvalid')
      return
    }

    authStore.login(trimmed)
    configureHttpClient({ token: trimmed })

    const redirect = (route.query.redirect as string) || '/'
    router.replace(redirect)
  } catch {
    error.value = t('common.login.errorNetwork')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
    <div class="w-full max-w-sm space-y-6 rounded-xl bg-white p-8 shadow-lg dark:bg-gray-800">
      <div class="text-center">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">ChatLab</h1>
        <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {{ t('common.login.description') }}
        </p>
      </div>

      <form class="space-y-4" @submit.prevent="handleLogin">
        <UFormField :label="t('common.login.tokenLabel')">
          <UInput
            v-model="tokenInput"
            type="password"
            :placeholder="t('common.login.tokenPlaceholder')"
            autocomplete="off"
            class="w-full"
          />
        </UFormField>

        <p v-if="error" class="text-sm text-red-500">{{ error }}</p>

        <UButton type="submit" block :loading="loading" color="primary">
          {{ t('common.login.submit') }}
        </UButton>
      </form>

      <p class="text-center text-xs text-gray-400 dark:text-gray-500">
        {{ t('common.login.hint') }}
      </p>
    </div>
  </div>
</template>
