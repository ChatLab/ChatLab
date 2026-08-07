import '@/icons/disable-iconify-api'
import 'virtual:nuxt-icon-bundle/register'

import { mountChatLabApp } from '@/bootstrap/mount-app'
import { installStartupPerformanceApi, markStartupPhase } from '@/bootstrap/startup-performance'

installStartupPerformanceApi()
markStartupPhase('renderer-module-ready')

void mountChatLabApp().catch((error) => {
  console.error('ChatLab startup failed', error)
})
