import '@/icons/disable-iconify-api'
import 'virtual:nuxt-icon-bundle/register'

import { mountChatLabApp } from '@/bootstrap/mount-app'

void mountChatLabApp().catch((error) => {
  console.error('ChatLab startup failed', error)
})
