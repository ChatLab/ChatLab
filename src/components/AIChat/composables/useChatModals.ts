/**
 * 助手 & 技能弹窗状态管理：统一管理所有弹窗的可见性和对应的打开/刷新操作。
 */

import { ref } from 'vue'
import { useAssistantStore } from '@/stores/assistant'
import { useSkillStore } from '@/stores/skill'

export function useChatModals() {
  const assistantStore = useAssistantStore()
  const skillStore = useSkillStore()

  // ── 助手弹窗状态 ──
  const configModalVisible = ref(false)
  const configModalAssistantId = ref<string | null>(null)
  const configModalReadonly = ref(false)
  const marketModalVisible = ref(false)

  // ── 技能弹窗状态 ──
  const skillMarketModalVisible = ref(false)
  const skillConfigModalVisible = ref(false)
  const skillConfigModalSkillId = ref<string | null>(null)

  // ── 助手弹窗 handlers ──

  function handleConfigureAssistant(id: string) {
    configModalAssistantId.value = id
    configModalReadonly.value = false
    configModalVisible.value = true
  }

  function handleOpenMarket() {
    marketModalVisible.value = true
  }

  function handleMarketConfigure(id: string) {
    configModalAssistantId.value = id
    configModalReadonly.value = false
    configModalVisible.value = true
  }

  function handleMarketViewConfig(id: string) {
    configModalAssistantId.value = id
    configModalReadonly.value = true
    configModalVisible.value = true
  }

  function handleCreateAssistant() {
    configModalAssistantId.value = null
    configModalReadonly.value = false
    configModalVisible.value = true
  }

  async function handleAssistantCreated(_id: string) {
    await assistantStore.loadAssistants()
    await assistantStore.loadBuiltinCatalog()
  }

  async function handleAssistantConfigSaved() {
    await assistantStore.loadAssistants()
  }

  // ── 技能弹窗 handlers ──

  function handleOpenSkillMarket() {
    skillMarketModalVisible.value = true
  }

  function handleSkillMarketConfigure(id: string) {
    skillConfigModalSkillId.value = id
    skillConfigModalVisible.value = true
  }

  function handleCreateSkill() {
    skillConfigModalSkillId.value = null
    skillConfigModalVisible.value = true
  }

  async function handleSkillConfigSaved() {
    await skillStore.loadSkills()
  }

  async function handleSkillCreated(_id: string) {
    await skillStore.loadSkills()
    await skillStore.loadBuiltinCatalog()
  }

  return {
    // 助手弹窗
    configModalVisible,
    configModalAssistantId,
    configModalReadonly,
    marketModalVisible,
    handleConfigureAssistant,
    handleOpenMarket,
    handleMarketConfigure,
    handleMarketViewConfig,
    handleCreateAssistant,
    handleAssistantCreated,
    handleAssistantConfigSaved,
    // 技能弹窗
    skillMarketModalVisible,
    skillConfigModalVisible,
    skillConfigModalSkillId,
    handleOpenSkillMarket,
    handleSkillMarketConfigure,
    handleCreateSkill,
    handleSkillConfigSaved,
    handleSkillCreated,
  }
}
