<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const emit = defineEmits<{
  openChangelog: []
  openTerms: []
}>()

const { t, locale } = useI18n()

// 配置 URL 根据语言动态获取
const CONFIG_BASE_URL = 'https://chatlab.fun'
const langPathMap: Record<string, string> = {
  'zh-CN': 'cn',
  'zh-TW': 'tw',
  'en-US': 'en',
  'ja-JP': 'ja',
}

const configUrl = computed(() => {
  const langPath = langPathMap[locale.value] ?? 'en'
  return `${CONFIG_BASE_URL}/${langPath}/config.json`
})

// 存储 key 也根据语言区分
const storageKey = computed(() => `chatlab_app_config_${locale.value}`)

// Footer 链接配置
interface FooterLink {
  id: string
  icon: string
  title: string
  url?: string
  action?: 'changelog' | 'terms'
}

// 默认链接配置（根据语言返回）
function getDefaultLinks(): FooterLink[] {
  return [
    {
      id: 'website',
      icon: 'i-heroicons-globe-alt',
      title: t('home.footer.website'),
      url: `https://chatlab.fun/${langPathMap[locale.value] ?? 'en'}/`,
    },
    {
      id: 'github',
      icon: 'i-simple-icons-github',
      title: 'Github',
      url: 'https://github.com/hellodigua/ChatLab',
    },
    {
      id: 'terms',
      icon: 'i-heroicons-document-text',
      title: t('home.footer.terms'),
      action: 'terms',
    },
    {
      id: 'changelog',
      icon: 'i-heroicons-document-text',
      title: t('home.changelog.title'),
      action: 'changelog',
    },
  ]
}

const footerLinks = ref<FooterLink[]>(getDefaultLinks())

// 社交链接配置
interface SocialConfig {
  xiaohongshu?: { show: boolean; url: string }
  x?: { show: boolean; url: string }
}

const socialConfig = ref<SocialConfig>({})

// 根据语言获取社交链接
const socialLink = computed(() => {
  const isChinese = locale.value.startsWith('zh')

  if (isChinese && socialConfig.value.xiaohongshu?.show) {
    return {
      title: '小红书',
      url: socialConfig.value.xiaohongshu.url,
    }
  }

  if (!isChinese && socialConfig.value.x?.show) {
    return {
      title: 'X',
      url: socialConfig.value.x.url,
    }
  }

  return null
})

/**
 * 从 localStorage 加载缓存的额外链接
 */
function loadCachedExtraLinks(): FooterLink[] | null {
  try {
    const cached = localStorage.getItem(storageKey.value)
    if (cached) {
      const config = JSON.parse(cached)
      // homeFooterExtraLinks 是额外的链接，会追加到默认链接之后
      return config.homeFooterExtraLinks || null
    }
  } catch (error) {
    // 缓存损坏时降级为默认链接，避免影响首页渲染。
    console.warn('[HomeFooter] 读取缓存额外链接失败，将使用默认链接。', error)
  }
  return null
}

/**
 * 从 localStorage 加载缓存的社交配置
 */
function loadCachedSocialConfig(): SocialConfig | null {
  try {
    const cached = localStorage.getItem(storageKey.value)
    if (cached) {
      const config = JSON.parse(cached)
      return config.social || null
    }
  } catch (error) {
    // 缓存损坏时降级为默认社交配置，保证页面功能可用。
    console.warn('[HomeFooter] 读取缓存社交配置失败，将使用默认配置。', error)
  }
  return null
}

/**
 * 获取远程配置
 * 注意：此配置包含多个用途的数据，如：
 * - homeFooterExtraLinks: 首页 Footer 额外链接
 * - footerLinkConfig: Sidebar Footer 链接配置
 * - social: 社交链接配置（xiaohongshu, x）
 * - aiTips: AI 模型配置提示
 */
async function fetchConfig(): Promise<void> {
  // 先加载缓存的额外链接
  const cachedExtra = loadCachedExtraLinks()
  if (cachedExtra && cachedExtra.length > 0) {
    footerLinks.value = [...getDefaultLinks(), ...cachedExtra]
  }

  // 加载缓存的社交配置
  const cachedSocial = loadCachedSocialConfig()
  if (cachedSocial) {
    socialConfig.value = cachedSocial
  }

  try {
    const result = await window.api.app.fetchRemoteConfig(configUrl.value)
    if (!result.success || !result.data) return

    const config = result.data as Record<string, unknown>
    // 保存整个配置对象（带语言后缀，用于 Footer）
    localStorage.setItem(storageKey.value, JSON.stringify(config))
    // 同时存储到不带后缀的 key（用于 AI 组件等其他地方）
    localStorage.setItem('chatlab_app_config', JSON.stringify(config))

    // 更新 footerLinks（追加额外链接）
    if (config.homeFooterExtraLinks && Array.isArray(config.homeFooterExtraLinks)) {
      footerLinks.value = [...getDefaultLinks(), ...(config.homeFooterExtraLinks as FooterLink[])]
    }

    // 更新社交配置
    if (config.social) {
      socialConfig.value = config.social as SocialConfig
    }
  } catch (error) {
    // 远程配置拉取失败时保留当前（默认或缓存）状态，避免打断用户使用。
    console.warn('[HomeFooter] 拉取远程配置失败，将继续使用本地配置。', error)
  }
}

// 处理链接点击
function handleLinkClick(link: FooterLink) {
  if (link.action === 'changelog') {
    emit('openChangelog')
  } else if (link.action === 'terms') {
    emit('openTerms')
  } else if (link.url) {
    window.open(link.url, '_blank')
  }
}

// 打开社交链接
function openSocialLink() {
  if (socialLink.value?.url) {
    window.open(socialLink.value.url, '_blank')
  }
}

// 组件挂载时获取配置
onMounted(() => {
  fetchConfig()
})

// 语言切换时重新获取配置
watch(locale, () => {
  // 先重置为默认链接（确保语言正确）
  footerLinks.value = getDefaultLinks()
  // 然后尝试获取远程配置
  fetchConfig()
})
</script>

<template>
  <div class="absolute bottom-4 left-0 right-0">
    <div class="flex items-center justify-center">
      <template v-for="(link, index) in footerLinks" :key="link.id">
        <!-- 分隔点 -->
        <span v-if="index > 0" class="mx-2 text-gray-300 dark:text-gray-600">·</span>
        <!-- 链接按钮 -->
        <button
          class="text-sm text-gray-500 hover:text-primary transition-colors dark:text-gray-400 dark:hover:text-primary"
          @click="handleLinkClick(link)"
        >
          {{ link.title }}
        </button>
      </template>

      <!-- 社交链接 -->
      <template v-if="socialLink">
        <span class="mx-2 text-gray-300 dark:text-gray-600">·</span>
        <button
          class="text-sm text-gray-500 hover:text-primary transition-colors dark:text-gray-400 dark:hover:text-primary"
          @click="openSocialLink"
        >
          {{ socialLink.title }}
        </button>
      </template>
    </div>
  </div>
</template>
