import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ChatRecordQuery } from '@/types/format'
import { useSettingsStore } from './settings'

/**
 * 全局界面状态（侧边栏、弹窗、聊天记录抽屉等）
 */
export const useLayoutStore = defineStore(
  'layout',
  () => {
    const settingsStore = useSettingsStore()
    const isSidebarCollapsed = ref(false)
    const isAIChatSidebarCollapsed = ref(false)
    const showScreenCaptureModal = ref(false)
    const screenCaptureImage = ref<string | null>(null)
    const sidePanelOpen = ref(false)
    const sidePanelView = ref<'records' | 'contact' | 'topics' | null>(null)
    const sidePanelDefaultView = ref<'records' | 'topics'>('records')
    const sidePanelSessionId = ref<string | null>(null)
    const sidePanelHasContact = ref(false)
    const chatRecordQuery = ref<ChatRecordQuery | null>(null)
    // Keep the existing persisted preference when replacing the drawer shell.
    const chatRecordDrawerWidth = ref(750)
    const contactPanelWidth = ref(420)
    const topicsPanelWidth = ref(320)
    const canOpenSidePanel = computed(() => Boolean(sidePanelView.value || sidePanelSessionId.value))
    const canReturnSidePanel = computed(
      () => sidePanelView.value === 'records' && (sidePanelHasContact.value || sidePanelDefaultView.value === 'topics')
    )

    const isToolsPanelLocked = ref(false)
    const isToolsPanelMini = ref(false)
    const toolsPanelPosition = ref<'side' | 'header'>('header')
    const effectiveToolsPanelPosition = computed<'side' | 'header'>(() =>
      settingsStore.debugMode ? toolsPanelPosition.value : 'header'
    )
    const isToolsPanelOpen = ref(false)

    // 设置弹窗
    const showSettings = ref(false)
    const settingsTab = ref<string>('settings')
    const settingsSubTab = ref<string | null>(null)

    /**
     * 切换侧边栏展开/折叠状态
     */
    function toggleSidebar() {
      isSidebarCollapsed.value = !isSidebarCollapsed.value
    }

    function toggleAIChatSidebar() {
      isAIChatSidebarCollapsed.value = !isAIChatSidebarCollapsed.value
    }

    /**
     * 打开截屏预览弹窗
     */
    function openScreenCaptureModal(imageData: string) {
      screenCaptureImage.value = imageData
      showScreenCaptureModal.value = true
    }

    /**
     * 关闭截屏预览弹窗
     */
    function closeScreenCaptureModal() {
      showScreenCaptureModal.value = false
      setTimeout(() => {
        screenCaptureImage.value = null
      }, 300)
    }

    function setSidePanelContext(sessionId: string | null, defaultView: 'records' | 'topics' = 'records') {
      const showTopics = Boolean(sessionId) && defaultView === 'topics'
      sidePanelOpen.value = showTopics
      sidePanelView.value = showTopics ? 'topics' : null
      sidePanelDefaultView.value = defaultView
      sidePanelHasContact.value = false
      chatRecordQuery.value = null
      sidePanelSessionId.value = sessionId
    }

    function openChatRecords(query: ChatRecordQuery) {
      const sessionId = query.sessionId || sidePanelSessionId.value
      if (!sessionId) return
      chatRecordQuery.value = { ...query, sessionId }
      sidePanelView.value = 'records'
      sidePanelOpen.value = true
    }

    function openContactPanel() {
      sidePanelHasContact.value = true
      sidePanelView.value = 'contact'
      sidePanelOpen.value = true
      chatRecordQuery.value = null
    }

    function returnToSidePanel() {
      if (!canReturnSidePanel.value) return
      sidePanelView.value = sidePanelHasContact.value ? 'contact' : 'topics'
      sidePanelOpen.value = true
    }

    function clearContactPanel() {
      sidePanelHasContact.value = false
      if (sidePanelView.value !== 'contact') return
      sidePanelView.value = null
      sidePanelOpen.value = false
    }

    function closeSidePanel() {
      sidePanelOpen.value = false
    }

    function toggleSidePanel() {
      if (!canOpenSidePanel.value) return
      if (!sidePanelView.value) {
        openChatRecords({})
        return
      }
      sidePanelOpen.value = !sidePanelOpen.value
    }

    function toggleToolsPanelLock() {
      isToolsPanelLocked.value = !isToolsPanelLocked.value
    }

    function toggleToolsPanelOpen() {
      isToolsPanelOpen.value = !isToolsPanelOpen.value
    }

    /**
     * 打开设置弹窗，可选指定 Tab 和 SubTab
     */
    function openSettings(tab?: string, subTab?: string) {
      settingsTab.value = tab || 'settings'
      settingsSubTab.value = subTab || null
      showSettings.value = true
    }

    function closeSettings() {
      showSettings.value = false
    }

    function toggleToolsPanelMini() {
      isToolsPanelMini.value = !isToolsPanelMini.value
      if (isToolsPanelMini.value) {
        isToolsPanelLocked.value = false
      }
    }

    return {
      isSidebarCollapsed,
      isAIChatSidebarCollapsed,
      isToolsPanelLocked,
      isToolsPanelMini,
      toolsPanelPosition,
      effectiveToolsPanelPosition,
      isToolsPanelOpen,
      showScreenCaptureModal,
      screenCaptureImage,
      sidePanelOpen,
      sidePanelView,
      sidePanelHasContact,
      canOpenSidePanel,
      canReturnSidePanel,
      chatRecordQuery,
      chatRecordDrawerWidth,
      contactPanelWidth,
      topicsPanelWidth,
      showSettings,
      settingsTab,
      settingsSubTab,
      toggleSidebar,
      toggleAIChatSidebar,
      toggleToolsPanelLock,
      toggleToolsPanelOpen,
      toggleToolsPanelMini,
      openScreenCaptureModal,
      closeScreenCaptureModal,
      setSidePanelContext,
      openChatRecords,
      openContactPanel,
      returnToSidePanel,
      clearContactPanel,
      closeSidePanel,
      toggleSidePanel,
      openSettings,
      closeSettings,
    }
  },
  {
    persist: [
      {
        pick: [
          'isSidebarCollapsed',
          'isAIChatSidebarCollapsed',
          'isToolsPanelLocked',
          'isToolsPanelMini',
          'toolsPanelPosition',
          'chatRecordDrawerWidth',
          'contactPanelWidth',
          'topicsPanelWidth',
        ],
        storage: localStorage,
      },
    ],
  }
)
