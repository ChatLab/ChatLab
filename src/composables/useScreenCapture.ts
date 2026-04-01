/**
 * 截屏功能 Composable
 * 提供简洁的 API 用于捕获页面/元素截图
 */
import { ref } from 'vue'
import { captureAsImageData } from '@/utils/snapCapture'
import { useToast } from '@nuxt/ui/runtime/composables/useToast.js'
import { useLayoutStore } from '@/stores/layout'

/** 默认移动端最大宽度 */
const DEFAULT_MOBILE_MAX_WIDTH = 525

export interface ScreenCaptureOptions {
  /** 截屏时要隐藏的元素选择器列表 */
  hideSelectors?: string[]
  /** 最大导出宽度 */
  maxExportWidth?: number
  /** 背景颜色 */
  backgroundColor?: string
  /** 是否捕获完整的可滚动内容（默认 true） */
  fullContent?: boolean
  /**
   * 移动端适配宽度，设置后会临时改变元素宽度以适配移动端布局
   * - 传入数字：使用指定宽度
   * - 传入 true：使用默认值 525px（自动适配，仅当原始宽度超过时才缩放）
   * - 传入 false 或不传：不进行移动端适配
   */
  mobileWidth?: number | boolean
}

/**
 * 截屏功能 Composable
 */
export function useScreenCapture() {
  const layoutStore = useLayoutStore()
  const toast = useToast()
  const isCapturing = ref(false)
  const captureError = ref<string | null>(null)

  // 保存最后一次截图数据（用于 Toast 操作）
  let lastCapturedImage: string | null = null

  /**
   * 保存图片到专用下载目录
   */
  async function downloadImage(imageData: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `chatlab-screenshot-${timestamp}.png`

    try {
      const result = await window.cacheApi.saveToDownloads(filename, imageData)
      if (result.success) {
        toast.add({
          title: '截图已保存',
          description: `已保存到下载目录：${filename}`,
          icon: 'i-heroicons-check-circle',
          color: 'primary',
          duration: 3000,
          actions: [
            {
              label: '打开目录',
              onClick: () => {
                window.cacheApi.openDir('downloads')
              },
            },
          ],
        })
      } else {
        throw new Error(result.error)
      }
    } catch (error) {
      console.error('保存图片失败:', error)
      toast.add({
        title: '保存失败',
        description: String(error),
        icon: 'i-heroicons-x-circle',
        color: 'error',
        duration: 3000,
      })
    }
  }

  /**
   * 显示截屏成功的 Toast
   */
  function showSuccessToast(imageData: string) {
    lastCapturedImage = imageData

    toast.add({
      title: '截图已复制到剪贴板',
      icon: 'i-heroicons-check-circle',
      color: 'primary',
      duration: 3000,
      actions: [
        {
          label: '预览截图',
          icon: 'i-heroicons-eye',
          onClick: () => {
            if (lastCapturedImage) {
              layoutStore.openScreenCaptureModal(lastCapturedImage)
            }
          },
        },
        {
          label: '保存',
          icon: 'i-heroicons-arrow-down-tray',
          onClick: () => {
            if (lastCapturedImage) {
              downloadImage(lastCapturedImage)
            }
          },
        },
      ],
    })
  }

  /**
   * 捕获指定选择器的元素
   * @param selector CSS 选择器（class 或 id）
   * @param options 截屏选项
   */
  async function capture(selector: string, options?: ScreenCaptureOptions): Promise<boolean> {
    const element = document.querySelector(selector) as HTMLElement | null
    if (!element) {
      captureError.value = `未找到元素: ${selector}`
      return false
    }
    return captureElement(element, options)
  }

  /**
   * 捕获指定的 DOM 元素
   * @param element 要截屏的 DOM 元素
   * @param options 截屏选项
   */
  async function captureElement(element: HTMLElement, options?: ScreenCaptureOptions): Promise<boolean> {
    if (isCapturing.value) return false

    isCapturing.value = true
    captureError.value = null

    // 临时给元素添加边距和 position: relative（用于水印定位）
    const originalPadding = element.style.padding
    const originalPaddingBottom = element.style.paddingBottom
    const originalPosition = element.style.position
    const originalWidth = element.style.width
    const originalMinWidth = element.style.minWidth
    const originalMaxWidth = element.style.maxWidth

    element.style.padding = '16px'
    element.style.paddingBottom = '48px' // 为水印留出空间
    const computedPosition = window.getComputedStyle(element).position
    if (computedPosition === 'static') {
      element.style.position = 'relative'
    }

    // 移动端宽度适配（渐进式缩放）
    let appliedMobileWidth = false
    if (options?.mobileWidth) {
      const baseWidth = typeof options.mobileWidth === 'number' ? options.mobileWidth : DEFAULT_MOBILE_MAX_WIDTH

      // 获取元素当前的实际宽度
      const currentWidth = element.getBoundingClientRect().width

      // 只有当原始宽度大于基准宽度时才缩放
      if (currentWidth > baseWidth) {
        // 渐进式缩放：目标宽度 = 基准宽度 + (原始宽度 - 基准宽度) × 缩放因子
        // 缩放因子 0.3 表示超出部分保留 30%
        const scaleFactor = 0.3
        const targetWidth = Math.round(baseWidth + (currentWidth - baseWidth) * scaleFactor)

        element.style.width = `${targetWidth}px`
        element.style.minWidth = `${targetWidth}px`
        element.style.maxWidth = `${targetWidth}px`
        appliedMobileWidth = true
      }
    }

    // 添加底部水印标识（绝对定位）
    const watermark = document.createElement('div')
    watermark.className = '__capture-watermark__'
    watermark.style.cssText = `
      position: absolute;
      left: 0;
      right: 0;
      bottom: 16px;
      text-align: center;
      font-size: 14px;
      color: #9ca3af;
    `
    watermark.textContent = '聊天分析实验室 · chatlab.fun'
    element.appendChild(watermark)

    // 隐藏指定元素（使用临时 class 而不是 inline style，避免恢复问题）
    const hiddenElements: HTMLElement[] = []
    const HIDDEN_CLASS = '__capture-hidden__'

    // 注入隐藏样式（如果不存在）
    let styleTag = document.getElementById('__capture-style__')
    if (!styleTag) {
      styleTag = document.createElement('style')
      styleTag.id = '__capture-style__'
      styleTag.textContent = `.${HIDDEN_CLASS} { display: none !important; }`
      document.head.appendChild(styleTag)
    }

    // 隐藏带有 .no-capture class 的元素（通用排除规则）
    const noCaptureElements = element.querySelectorAll('.no-capture')
    noCaptureElements.forEach((el) => {
      const htmlEl = el as HTMLElement
      hiddenElements.push(htmlEl)
      htmlEl.classList.add(HIDDEN_CLASS)
    })

    // 隐藏用户指定的选择器元素
    if (options?.hideSelectors) {
      for (const selector of options.hideSelectors) {
        const elements = document.querySelectorAll(selector)
        elements.forEach((el) => {
          const htmlEl = el as HTMLElement
          hiddenElements.push(htmlEl)
          htmlEl.classList.add(HIDDEN_CLASS)
        })
      }
    }

    // 如果需要捕获完整内容，临时移除 overflow 限制
    const fullContent = options?.fullContent !== false
    const overflowElements: {
      el: HTMLElement
      originalOverflow: string
      originalHeight: string
      originalMaxHeight: string
    }[] = []

    if (fullContent) {
      // 处理目标元素及其所有子元素的 overflow 和 max-height 限制
      const elementsWithOverflow = [element, ...Array.from(element.querySelectorAll('*'))] as HTMLElement[]
      for (const node of elementsWithOverflow) {
        const style = window.getComputedStyle(node)
        const overflow = style.overflow
        const overflowY = style.overflowY
        const maxHeight = style.maxHeight

        if (
          overflow === 'hidden' ||
          overflow === 'auto' ||
          overflow === 'scroll' ||
          overflowY === 'hidden' ||
          overflowY === 'auto' ||
          overflowY === 'scroll' ||
          (maxHeight !== 'none' && maxHeight !== '0px')
        ) {
          overflowElements.push({
            el: node,
            originalOverflow: node.style.overflow,
            originalHeight: node.style.height,
            originalMaxHeight: node.style.maxHeight,
          })
          node.style.overflow = 'visible'
          node.style.maxHeight = 'none'
          // 如果有固定高度，也需要临时移除
          if (style.height !== 'auto' && node.scrollHeight > node.clientHeight) {
            node.style.height = 'auto'
          }
        }
      }

      // 也处理祖先元素
      let parent: HTMLElement | null = element.parentElement
      while (parent) {
        const style = window.getComputedStyle(parent)
        const overflow = style.overflow
        const overflowY = style.overflowY
        if (
          overflow === 'hidden' ||
          overflow === 'auto' ||
          overflow === 'scroll' ||
          overflowY === 'hidden' ||
          overflowY === 'auto' ||
          overflowY === 'scroll'
        ) {
          overflowElements.push({
            el: parent,
            originalOverflow: parent.style.overflow,
            originalHeight: parent.style.height,
            originalMaxHeight: parent.style.maxHeight,
          })
          parent.style.overflow = 'visible'
        }
        parent = parent.parentElement
      }
    }

    // 修复 Chart.js canvas 黑色边框问题（@zumer/snapdom bug）
    const canvasElements: { el: HTMLCanvasElement; originalOutline: string; originalBorder: string }[] = []
    const canvases = element.querySelectorAll('canvas')
    canvases.forEach((canvas) => {
      canvasElements.push({
        el: canvas,
        originalOutline: canvas.style.outline,
        originalBorder: canvas.style.border,
      })
      canvas.style.outline = 'none'
      canvas.style.border = 'none'
    })

    // 修复 Markdown 标题元素在 @zumer/snapdom 中的黑色边框问题
    // 注意：不修改 background，以保留渐变文字等效果
    const headingElements: {
      el: HTMLElement
      originalStyles: {
        border: string
        outline: string
        boxShadow: string
      }
    }[] = []
    const headings = element.querySelectorAll('h1, h2, h3, h4, h5, h6')
    headings.forEach((heading) => {
      const htmlEl = heading as HTMLElement
      headingElements.push({
        el: htmlEl,
        originalStyles: {
          border: htmlEl.style.border,
          outline: htmlEl.style.outline,
          boxShadow: htmlEl.style.boxShadow,
        },
      })
      // 只清除边框相关样式，保留 background/margin/padding
      htmlEl.style.border = 'none'
      htmlEl.style.outline = 'none'
      htmlEl.style.boxShadow = 'none'
    })

    // 修复 Markdown 列表元素在 @zumer/snapdom 中的渲染问题
    // BUG: @zumer/snapdom 在处理 <ol>/<ul> 的 list-style 时会产生额外的黑色边框和位置偏移
    // 解决方案：临时移除 list-style，手动添加数字/圆点作为文本前缀
    const listElements: {
      el: HTMLElement
      originalStyles: {
        listStyleType: string
        paddingLeft: string
        marginLeft: string
        border: string
        outline: string
        boxShadow: string
      }
      addedPrefixes: HTMLSpanElement[]
    }[] = []
    const lists = element.querySelectorAll('ol, ul')
    lists.forEach((list) => {
      const htmlEl = list as HTMLElement
      const isOrdered = htmlEl.tagName.toLowerCase() === 'ol'
      const addedPrefixes: HTMLSpanElement[] = []

      listElements.push({
        el: htmlEl,
        originalStyles: {
          listStyleType: htmlEl.style.listStyleType,
          paddingLeft: htmlEl.style.paddingLeft,
          marginLeft: htmlEl.style.marginLeft,
          border: htmlEl.style.border,
          outline: htmlEl.style.outline,
          boxShadow: htmlEl.style.boxShadow,
        },
        addedPrefixes,
      })

      // 移除列表样式以避免 @zumer/snapdom 渲染问题
      htmlEl.style.listStyleType = 'none'
      htmlEl.style.paddingLeft = '0'
      htmlEl.style.marginLeft = '0'
      // 移除边框以修复 @zumer/snapdom 的黑色边框 bug
      htmlEl.style.border = 'none'
      htmlEl.style.outline = 'none'
      htmlEl.style.boxShadow = 'none'

      // 为每个 li 添加手动前缀
      const lis = htmlEl.querySelectorAll(':scope > li')
      lis.forEach((li, index) => {
        const prefix = document.createElement('span')
        prefix.className = '__screen-capture-list-prefix__'
        prefix.style.cssText = 'display: inline-block; min-width: 1.5em; margin-right: 0.25em; text-align: right;'
        prefix.textContent = isOrdered ? `${index + 1}.` : '•'
        li.insertBefore(prefix, li.firstChild)
        addedPrefixes.push(prefix)
      })
    })

    // 清理可能导致 URI malformed 错误的特殊字符（孤立的 Unicode 代理对）
    const textNodesBackup: { node: Text; originalText: string }[] = []
    const cleanProblematicCharacters = (text: string): string => {
      // 移除孤立的代理对（会导致 encodeURIComponent 失败）
      // 高代理：\uD800-\uDBFF，低代理：\uDC00-\uDFFF
      // 有效的代理对应该是 高代理+低代理 的组合
      return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null)
    let textNode: Text | null
    while ((textNode = walker.nextNode() as Text | null)) {
      const originalText = textNode.textContent || ''
      const cleanedText = cleanProblematicCharacters(originalText)
      if (originalText !== cleanedText) {
        textNodesBackup.push({ node: textNode, originalText })
        textNode.textContent = cleanedText
      }
    }

    try {
      // 如果应用了移动端宽度，等待 DOM 重新布局
      if (appliedMobileWidth) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve())
          })
        })
      }

      const imageData = await captureAsImageData(element, {
        maxExportWidth: options?.maxExportWidth,
        backgroundColor: options?.backgroundColor,
        fullContent: options?.fullContent,
      })

      // 自动复制到剪贴板
      const copyResult = await window.api.clipboard.copyImage(imageData)

      if (copyResult.success) {
        // 显示成功 Toast（包含预览和下载按钮）
        showSuccessToast(imageData)
      } else {
        // 复制失败时，直接打开预览弹窗
        toast.add({
          title: '截图完成',
          description: '复制到剪贴板失败，请手动保存',
          icon: 'i-heroicons-exclamation-triangle',
          color: 'warning',
          duration: 3000,
        })
        layoutStore.openScreenCaptureModal(imageData)
      }

      return true
    } catch (error) {
      captureError.value = String(error)
      console.error('截屏失败:', error)

      // 提供更友好的错误提示
      let errorMessage = String(error)
      if (errorMessage.includes('URI malformed')) {
        errorMessage = '页面包含无法处理的特殊字符，请尝试截屏其他区域'
      }

      toast.add({
        title: '截屏失败',
        description: errorMessage,
        icon: 'i-heroicons-x-circle',
        color: 'error',
        duration: 3000,
      })
      return false
    } finally {
      // 移除水印
      watermark.remove()

      // 恢复元素样式
      element.style.padding = originalPadding
      element.style.paddingBottom = originalPaddingBottom
      element.style.position = originalPosition
      element.style.width = originalWidth
      element.style.minWidth = originalMinWidth
      element.style.maxWidth = originalMaxWidth

      // 恢复文本节点的原始内容
      for (const { node, originalText } of textNodesBackup) {
        node.textContent = originalText
      }
      // 恢复 canvas 样式
      for (const { el, originalOutline, originalBorder } of canvasElements) {
        el.style.outline = originalOutline
        el.style.border = originalBorder
      }
      // 恢复标题元素样式（@zumer/snapdom bug workaround）
      for (const { el, originalStyles } of headingElements) {
        el.style.border = originalStyles.border
        el.style.outline = originalStyles.outline
        el.style.boxShadow = originalStyles.boxShadow
      }
      // 恢复列表元素样式并移除手动添加的前缀（@zumer/snapdom bug workaround）
      for (const { el, originalStyles, addedPrefixes } of listElements) {
        el.style.listStyleType = originalStyles.listStyleType
        el.style.paddingLeft = originalStyles.paddingLeft
        el.style.marginLeft = originalStyles.marginLeft
        el.style.border = originalStyles.border
        el.style.outline = originalStyles.outline
        el.style.boxShadow = originalStyles.boxShadow
        // 移除手动添加的前缀
        for (const prefix of addedPrefixes) {
          prefix.remove()
        }
      }
      // 恢复 overflow 设置
      for (const { el, originalOverflow, originalHeight, originalMaxHeight } of overflowElements) {
        el.style.overflow = originalOverflow
        el.style.height = originalHeight
        el.style.maxHeight = originalMaxHeight
      }
      // 恢复隐藏元素
      for (const el of hiddenElements) {
        el.classList.remove('__capture-hidden__')
      }
      isCapturing.value = false
    }
  }

  /**
   * 捕获当前页面的主内容区域
   * 优先查找 .main-content 标记的实际内容区域
   * @param options 截屏选项
   */
  async function capturePage(options?: ScreenCaptureOptions): Promise<boolean> {
    // 优先查找标记了 .main-content 的实际内容区域
    // 这是页面截屏的标准约定，详见 .docs/rules.md
    const mainContent =
      document.querySelector('.main-content') ||
      document.querySelector('main .overflow-y-auto') ||
      document.querySelector('main')

    if (!mainContent) {
      captureError.value = '未找到可截屏的页面区域'
      return false
    }

    return captureElement(mainContent as HTMLElement, options)
  }

  return {
    /** 是否正在截屏 */
    isCapturing,
    /** 截屏错误信息 */
    captureError,
    /** 截屏指定选择器的元素 */
    capture,
    /** 截屏指定 DOM 元素 */
    captureElement,
    /** 截屏当前页面主内容区域 */
    capturePage,
  }
}
