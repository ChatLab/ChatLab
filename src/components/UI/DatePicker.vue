<script setup lang="ts">
/**
 * 日期选择器组件
 * 基于 UPopover + UCalendar 封装
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import { CalendarDate } from '@internationalized/date'

const { t, locale } = useI18n()

const props = withDefaults(
  defineProps<{
    /** 日期值 (YYYY-MM-DD 格式字符串) */
    modelValue: string
    /** 占位符文本 */
    placeholder?: string
    /** 是否显示清空按钮 */
    clearable?: boolean
    /** 按钮宽度类 */
    widthClass?: string
  }>(),
  {
    placeholder: '',
    clearable: true,
    widthClass: 'w-32',
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

// Popover 开关状态
const popoverOpen = ref(false)

// 日历组件的 locale
const calendarLocale = computed(() => {
  if (locale.value.startsWith('zh')) return 'zh-CN'
  if (locale.value === 'ja-JP') return 'ja-JP'
  return 'en-US'
})

// 辅助函数：将字符串日期转换为 CalendarDate
function stringToCalendarDate(dateStr: string): CalendarDate | undefined {
  if (!dateStr) return undefined
  const d = dayjs(dateStr)
  return new CalendarDate(d.year(), d.month() + 1, d.date())
}

// 辅助函数：将 CalendarDate 转换为字符串
function calendarDateToString(date: CalendarDate | undefined): string {
  if (!date) return ''
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}

// CalendarDate 对象（用于 UCalendar 双向绑定）
const dateObj = computed<CalendarDate | undefined>({
  get: () => stringToCalendarDate(props.modelValue),
  set: (val) => {
    emit('update:modelValue', calendarDateToString(val))
    if (val) popoverOpen.value = false
  },
})

// 格式化显示的日期
const dateDisplay = computed(() => (props.modelValue ? dayjs(props.modelValue).format('YYYY/MM/DD') : ''))

// 清空日期
function clearDate() {
  emit('update:modelValue', '')
  popoverOpen.value = false
}
</script>

<template>
  <UPopover v-model:open="popoverOpen" :ui="{ content: 'z-[100]' }">
    <UButton
      :label="dateDisplay || placeholder || t('common.datePicker.selectDate')"
      icon="i-heroicons-calendar-days"
      variant="outline"
      color="neutral"
      size="sm"
      :class="[widthClass, 'justify-start', { 'text-gray-400': !dateDisplay }]"
    />
    <template #content>
      <UCalendar v-model="dateObj" :number-of-months="1" :fixed-weeks="false" :locale="calendarLocale" />
      <div v-if="clearable" class="px-2 pb-2">
        <UButton variant="ghost" size="xs" color="neutral" class="w-full" @click="clearDate">
          {{ t('common.datePicker.clearDate') }}
        </UButton>
      </div>
    </template>
  </UPopover>
</template>
