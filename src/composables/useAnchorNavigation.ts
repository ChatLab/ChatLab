import { ref, onMounted, onUnmounted, type Ref, type ComputedRef } from 'vue'

export interface AnchorNavigationItem {
  id: string
  label: string
  icon?: string
}

export interface AnchorNavigationOptions {
  scrollBehavior?: ScrollBehavior
  scrollLockDuration?: number
}

/**
 * 实现锚点导航与内容区域的滚动联动。
 */
export function useAnchorNavigation(
  navItems: ComputedRef<AnchorNavigationItem[]> | Ref<AnchorNavigationItem[]>,
  options: AnchorNavigationOptions = {}
) {
  const scrollBehavior = options.scrollBehavior ?? 'smooth'
  const scrollLockDuration = options.scrollLockDuration ?? 500
  const activeNav = ref(navItems.value[0]?.id || '')
  const isUserClick = ref(false)
  const scrollContainerRef = ref<HTMLElement | null>(null)
  const sectionRefs = ref<Record<string, HTMLElement | null>>({})

  function setSectionRef(id: string, el: HTMLElement | null) {
    sectionRefs.value[id] = el
  }

  function handleNavChange(id: string) {
    const section = sectionRefs.value[id]
    if (!section || !scrollContainerRef.value) return

    isUserClick.value = true
    section.scrollIntoView({ behavior: scrollBehavior, block: 'start' })
    setTimeout(() => {
      isUserClick.value = false
    }, scrollLockDuration)
  }

  function handleScroll() {
    if (isUserClick.value || !scrollContainerRef.value) return

    const container = scrollContainerRef.value
    const containerRect = container.getBoundingClientRect()
    const offset = 50
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 5

    if (isAtBottom) {
      const lastItem = navItems.value[navItems.value.length - 1]
      if (lastItem) activeNav.value = lastItem.id
      return
    }

    for (const item of navItems.value) {
      const section = sectionRefs.value[item.id]
      if (!section) continue

      const rect = section.getBoundingClientRect()
      if (rect.top <= containerRect.top + offset && rect.bottom > containerRect.top + offset) {
        activeNav.value = item.id
        break
      }
    }
  }

  onMounted(() => {
    scrollContainerRef.value?.addEventListener('scroll', handleScroll)
  })

  onUnmounted(() => {
    scrollContainerRef.value?.removeEventListener('scroll', handleScroll)
  })

  function scrollToId(id: string) {
    const section = sectionRefs.value[id]
    if (!section || !scrollContainerRef.value) return

    isUserClick.value = true
    section.scrollIntoView({ behavior: scrollBehavior, block: 'start' })
    activeNav.value = id
    setTimeout(() => {
      isUserClick.value = false
    }, scrollLockDuration)
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
