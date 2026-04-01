import { ref, onMounted, onUnmounted, type Ref, type ComputedRef } from 'vue'

/**
 * 导航项配置
 */
export interface SubTabNavItem {
  id: string
  label: string
  icon?: string
}

/**
 * 二级导航滚动联动 composable
 * 实现左侧锚点导航与右侧内容区域的滚动联动
 */
export function useSubTabsScroll(navItems: ComputedRef<SubTabNavItem[]> | Ref<SubTabNavItem[]>) {
  // 当前激活的导航项
  const activeNav = ref(navItems.value[0]?.id || '')

  // 是否由用户点击触发（用于区分点击滚动和手动滚动）
  const isUserClick = ref(false)

  // 滚动容器引用
  const scrollContainerRef = ref<HTMLElement | null>(null)

  // Section 引用
  const sectionRefs = ref<Record<string, HTMLElement | null>>({})

  /**
   * 设置 section 引用
   */
  function setSectionRef(id: string, el: HTMLElement | null) {
    sectionRefs.value[id] = el
  }

  /**
   * 处理导航点击（通过 @change 事件）
   */
  function handleNavChange(id: string) {
    const section = sectionRefs.value[id]
    if (section && scrollContainerRef.value) {
      // 标记为用户点击触发
      isUserClick.value = true
      section.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // 滚动动画结束后恢复
      setTimeout(() => {
        isUserClick.value = false
      }, 500)
    }
  }

  /**
   * 监听滚动更新当前激活项
   */
  function handleScroll() {
    // 如果是用户点击触发的滚动，不更新 activeNav（避免冲突）
    if (isUserClick.value || !scrollContainerRef.value) return

    const container = scrollContainerRef.value
    const containerRect = container.getBoundingClientRect()
    const offset = 50 // 偏移量，提前触发

    // 检查是否滚动到底部（误差范围 5px）
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 5
    if (isAtBottom) {
      // 滚动到底部时，激活最后一个导航项
      const lastItem = navItems.value[navItems.value.length - 1]
      if (lastItem) {
        activeNav.value = lastItem.id
      }
      return
    }

    // 检查每个 section 的位置
    for (const item of navItems.value) {
      const section = sectionRefs.value[item.id]
      if (section) {
        const rect = section.getBoundingClientRect()
        // 如果 section 顶部在容器可视区域内
        if (rect.top <= containerRect.top + offset && rect.bottom > containerRect.top + offset) {
          activeNav.value = item.id
          break
        }
      }
    }
  }

  // 生命周期钩子
  onMounted(() => {
    scrollContainerRef.value?.addEventListener('scroll', handleScroll)
  })

  onUnmounted(() => {
    scrollContainerRef.value?.removeEventListener('scroll', handleScroll)
  })

  /**
   * 程序化滚动到指定 section（供外部调用）
   */
  function scrollToId(id: string) {
    const section = sectionRefs.value[id]
    if (section && scrollContainerRef.value) {
      isUserClick.value = true
      section.scrollIntoView({ behavior: 'smooth', block: 'start' })
      activeNav.value = id
      setTimeout(() => {
        isUserClick.value = false
      }, 500)
    }
  }

  return {
    activeNav,
    scrollContainerRef,
    sectionRefs,
    setSectionRef,
    handleNavChange,
    scrollToId,
  }
}
