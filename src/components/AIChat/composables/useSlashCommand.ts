/**
 * /技能 slash 命令菜单：输入框开头键入 "/" 时弹出技能列表，支持筛选和键盘导航。
 */

import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import type { SkillSummary } from '@/stores/skill'

export function useSlashCommand(compatibleSkills: Ref<SkillSummary[]>) {
  const showSlashMenu = ref(false)
  const slashFilter = ref('')
  const slashHighlightIndex = ref(0)
  const dismissedSlashValue = ref<string | null>(null)

  const filteredSkills = computed(() => {
    const keyword = slashFilter.value.trim().toLocaleLowerCase()
    if (!keyword) return compatibleSkills.value

    return compatibleSkills.value.filter((skill) => {
      const haystack = [skill.name, skill.description, skill.tags.join(' ')].join(' ').toLocaleLowerCase()
      return haystack.includes(keyword)
    })
  })

  function resetSlashState() {
    showSlashMenu.value = false
    slashFilter.value = ''
    slashHighlightIndex.value = 0
  }

  function dismissSlashMenu(currentValue?: string) {
    if (currentValue !== undefined && /^\s*\/([^\n]*)$/.test(currentValue)) {
      dismissedSlashValue.value = currentValue
    }
    resetSlashState()
  }

  /** 根据当前输入值决定是否显示 slash 菜单 */
  function updateSlashState(value: string, disabled: boolean) {
    if (disabled) {
      resetSlashState()
      return
    }

    if (dismissedSlashValue.value && dismissedSlashValue.value !== value) {
      dismissedSlashValue.value = null
    }

    const match = value.match(/^\s*\/([^\n]*)$/)
    if (!match) {
      resetSlashState()
      return
    }

    const shouldResetHighlight = !showSlashMenu.value || slashFilter.value !== match[1]
    slashFilter.value = match[1]

    if (dismissedSlashValue.value === value) {
      showSlashMenu.value = false
      return
    }

    showSlashMenu.value = true
    if (shouldResetHighlight) {
      slashHighlightIndex.value = 0
    }
  }

  function moveSlashHighlight(step: 1 | -1) {
    if (!filteredSkills.value.length) return
    const total = filteredSkills.value.length
    slashHighlightIndex.value = (slashHighlightIndex.value + step + total) % total
  }

  /** 筛选列表变化时修正高亮索引 */
  function clampSlashHighlight() {
    const len = filteredSkills.value.length
    if (len === 0) {
      slashHighlightIndex.value = 0
    } else if (slashHighlightIndex.value >= len) {
      slashHighlightIndex.value = len - 1
    }
  }

  return {
    showSlashMenu,
    slashFilter,
    slashHighlightIndex,
    dismissedSlashValue,
    filteredSkills,
    resetSlashState,
    dismissSlashMenu,
    updateSlashState,
    moveSlashHighlight,
    clampSlashHighlight,
  }
}
