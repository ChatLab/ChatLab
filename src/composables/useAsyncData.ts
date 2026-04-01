import { ref, watch, type Ref, type ComputedRef } from 'vue'

/**
 * 异步数据加载 Composable
 * 统一处理数据加载、状态管理和错误处理
 */

interface TimeFilter {
  startTs?: number
  endTs?: number
}

interface UseAsyncDataOptions<T> {
  /** 是否立即加载数据（默认 true） */
  immediate?: boolean
  /** 是否深度监听 timeFilter（默认 true） */
  deep?: boolean
  /** 加载失败时的错误处理 */
  onError?: (error: Error) => void
  /** 默认值 */
  defaultValue?: T
}

interface UseAsyncDataReturn<T> {
  /** 数据 */
  data: Ref<T | null>
  /** 是否正在加载 */
  isLoading: Ref<boolean>
  /** 错误信息 */
  error: Ref<Error | null>
  /** 重新加载 */
  reload: () => Promise<void>
}

/**
 * 通用异步数据加载 composable
 * @param fetchFn 数据获取函数
 * @param sessionId 会话 ID（响应式）
 * @param timeFilter 时间筛选条件（可选，响应式）
 * @param options 配置选项
 */
export function useAsyncData<T>(
  fetchFn: (sessionId: string, timeFilter?: TimeFilter) => Promise<T>,
  sessionId: Ref<string> | ComputedRef<string>,
  timeFilter?: Ref<TimeFilter | undefined> | ComputedRef<TimeFilter | undefined>,
  options: UseAsyncDataOptions<T> = {}
): UseAsyncDataReturn<T> {
  const { immediate = true, deep = true, onError, defaultValue } = options

  const data = ref<T | null>(defaultValue ?? null) as Ref<T | null>
  const isLoading = ref(false)
  const error = ref<Error | null>(null)

  async function load() {
    const sid = sessionId.value
    if (!sid) return

    isLoading.value = true
    error.value = null

    try {
      data.value = await fetchFn(sid, timeFilter?.value)
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      error.value = err
      if (onError) {
        onError(err)
      } else {
        console.error('数据加载失败:', err)
      }
    } finally {
      isLoading.value = false
    }
  }

  // 监听 sessionId 和 timeFilter 变化
  watch(
    () => [sessionId.value, timeFilter?.value],
    () => {
      if (sessionId.value) {
        load()
      }
    },
    { immediate, deep }
  )

  return {
    data,
    isLoading,
    error,
    reload: load,
  }
}

/**
 * 批量加载多个异步数据
 * @param loaders 加载函数数组
 */
export function useMultipleAsyncData(loaders: Array<() => Promise<void>>) {
  const isLoading = ref(false)

  async function loadAll() {
    isLoading.value = true
    try {
      await Promise.all(loaders.map((loader) => loader()))
    } finally {
      isLoading.value = false
    }
  }

  return {
    isLoading,
    loadAll,
  }
}
