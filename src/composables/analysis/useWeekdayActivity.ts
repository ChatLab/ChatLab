import { ref, watch } from 'vue'
import type { TimeFilter } from '@openchatlab/shared-types'
import { useDataService } from '@/services'
import type { WeekdayActivity } from '@/types/analysis'

interface UseWeekdayActivityOptions {
  sessionId: () => string
  timeFilter: () => TimeFilter | undefined
}

export function useWeekdayActivity(options: UseWeekdayActivityOptions) {
  const weekdayActivity = ref<WeekdayActivity[]>([])
  let loadVersion = 0

  async function loadWeekdayActivity() {
    const currentVersion = ++loadVersion
    const sessionId = options.sessionId()
    if (!sessionId) {
      weekdayActivity.value = []
      return
    }

    try {
      const result = await useDataService().getWeekdayActivity(sessionId, options.timeFilter())
      // Browser Runtime 查询无法被 HTTP epoch 取消，旧筛选完成后不得覆盖最新结果。
      if (currentVersion === loadVersion) {
        weekdayActivity.value = result
      }
    } catch (error) {
      if (currentVersion === loadVersion) {
        console.error('Failed to load weekday activity:', error)
      }
    }
  }

  watch([options.sessionId, options.timeFilter], () => loadWeekdayActivity(), { immediate: true, deep: true })

  return { weekdayActivity }
}
