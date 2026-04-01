import { ref, onMounted, onUnmounted } from 'vue'

export interface AnchorItem {
  id: string
  label: string
}

/**
 * 页面锚点导航 Composable
 * @param anchors 锚点配置数组
 * @param options 配置选项
 */
export function usePageAnchors(
  anchors: AnchorItem[],
  options: {
    /** 判断线位置（距离视口顶部的距离），默认 300 */
    threshold?: number
    /** 滚动容器选择器，默认 '.overflow-y-auto' */
    containerSelector?: string
    /** 滚动锁定时间（毫秒），默认 800 */
    scrollLockDuration?: number
  } = {}
) {
  const { threshold = 300, containerSelector = '.overflow-y-auto', scrollLockDuration = 800 } = options

  // 当前激活的锚点
  const activeAnchor = ref(anchors[0]?.id || '')
  // 是否正在滚动（用于防止自动检测覆盖手动点击）
  let isScrolling = false
  // 内容容器 ref
  const contentRef = ref<HTMLElement | null>(null)
  // 滚动容器
  let scrollContainer: Element | null = null

  /**
   * 更新激活的锚点（基于滚动位置）
   */
  function updateActiveAnchor() {
    if (isScrolling) return

    // 收集所有锚点的位置信息
    const positions: { id: string; top: number }[] = []
    anchors.forEach((anchor) => {
      const element = document.getElementById(anchor.id)
      if (element) {
        const rect = element.getBoundingClientRect()
        positions.push({ id: anchor.id, top: Math.round(rect.top) })
      }
    })

    // 找到第一个 rect.top > threshold 的元素的前一个
    let activeIndex = 0
    for (let i = 0; i < positions.length; i++) {
      if (positions[i].top > threshold) {
        activeIndex = Math.max(0, i - 1)
        break
      }
      activeIndex = i
    }

    activeAnchor.value = anchors[activeIndex]?.id || ''
  }

  /**
   * 滚动到指定锚点
   */
  function scrollToAnchor(id: string) {
    const element = document.getElementById(id)
    if (element) {
      // 立即设置激活状态
      activeAnchor.value = id
      // 禁用自动检测
      isScrolling = true
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // 滚动完成后重新启用自动检测
      setTimeout(() => {
        isScrolling = false
        updateActiveAnchor()
      }, scrollLockDuration)
    }
  }

  onMounted(() => {
    // 向上查找滚动容器
    scrollContainer = contentRef.value?.closest(containerSelector) || null
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', updateActiveAnchor, { passive: true })
      updateActiveAnchor()
    }
  })

  onUnmounted(() => {
    if (scrollContainer) {
      scrollContainer.removeEventListener('scroll', updateActiveAnchor)
    }
  })

  return {
    /** 内容容器 ref，需要绑定到包含锚点的容器上 */
    contentRef,
    /** 当前激活的锚点 ID */
    activeAnchor,
    /** 滚动到指定锚点 */
    scrollToAnchor,
    /** 手动更新激活状态 */
    updateActiveAnchor,
  }
}
