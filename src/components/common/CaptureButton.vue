<script setup lang="ts">
import { useScreenCapture } from '@/composables'
import { ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useLayoutStore } from '@/stores/layout'
import { useI18n } from 'vue-i18n'

/**
 * 通用截屏按钮组件
 * 支持页面截屏和元素截屏两种模式
 */

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    /** 按钮显示文字（不传则只显示图标） */
    label?: string
    /** 按钮尺寸 */
    size?: 'xs' | 'sm' | 'md'
    /** 截屏类型：page=整页, element=指定元素 */
    type?: 'page' | 'element'
    /** 当 type='element' 时，要截屏的元素 */
    targetElement?: HTMLElement | null
    /** 当 type='element' 时，从按钮向上查找目标元素的选择器 */
    targetSelector?: string
  }>(),
  {
    size: 'sm',
    type: 'page',
  }
)

const { isCapturing, capturePage, captureElement } = useScreenCapture()
const layoutStore = useLayoutStore()
const { screenshotMobileAdapt } = storeToRefs(layoutStore)

// 生成唯一 ID 用于隐藏按钮自身
const buttonId = ref('')
onMounted(() => {
  buttonId.value = `capture-btn-${Math.random().toString(36).slice(2, 8)}`
})

async function handleCapture(event: Event) {
  const btn = event.currentTarget as HTMLElement

  // 根据用户设置决定是否启用移动端适配
  const defaultOptions = {
    hideSelectors: [`#${buttonId.value}`],
    mobileWidth: screenshotMobileAdapt.value ? true : undefined,
  }

  if (props.type === 'page') {
    await capturePage(defaultOptions)
  } else if (props.type === 'element') {
    let target: HTMLElement | null = null

    if (props.targetElement) {
      target = props.targetElement
    } else if (props.targetSelector) {
      target = btn.closest(props.targetSelector) as HTMLElement | null
    }

    if (target) {
      await captureElement(target, defaultOptions)
    }
  }
}
</script>

<template>
  <UTooltip :text="t('common.capture')" class="no-capture">
    <UButton
      :id="buttonId"
      icon="i-heroicons-camera"
      variant="ghost"
      color="primary"
      :size="size"
      :loading="isCapturing"
      @click="handleCapture"
    >
      <template v-if="label">{{ label }}</template>
    </UButton>
  </UTooltip>
</template>
