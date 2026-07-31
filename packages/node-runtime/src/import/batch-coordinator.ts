export interface KeyedBatchTask<T> {
  value: T
  key: string
  /**
   * Exclusive tasks form a barrier: they start only after all earlier work
   * finishes, and no later work starts until they complete.
   */
  exclusive?: boolean
}

export type KeyedBatchTaskResult<T> =
  | { status: 'success'; value: T }
  | { status: 'failed'; error: string }
  | { status: 'cancelled' }

export interface KeyedBatchOptions<TInput, TOutput> {
  concurrency?: number
  signal?: AbortSignal
  run(task: TInput, index: number): Promise<TOutput>
  onTaskStart?: (task: TInput, index: number) => void
  onTaskComplete?: (task: TInput, index: number, result: KeyedBatchTaskResult<TOutput>) => void
}

export function normalizeBatchConcurrency(value: unknown, taskCount: number): number {
  if (taskCount <= 0) return 0
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return 1
  return Math.min(value, taskCount)
}

export function resolveDefaultBatchConcurrency(
  taskCount: number,
  resources: { cpuCount?: number; totalMemoryBytes?: number } = {}
): number {
  if (taskCount <= 0) return 0
  const cpuCount = resources.cpuCount ?? cpus().length
  const totalMemoryBytes = resources.totalMemoryBytes ?? totalmem()
  const lowResourceRuntime = cpuCount < 4 || totalMemoryBytes < 4 * 1024 * 1024 * 1024
  return Math.min(taskCount, lowResourceRuntime ? 1 : 2)
}

/**
 * Run keyed work with bounded concurrency while serializing identical keys.
 * Exclusive tasks are ordering barriers for work whose target cannot be
 * resolved safely before writes begin.
 */
export async function runKeyedBatch<TInput, TOutput>(
  tasks: Array<KeyedBatchTask<TInput>>,
  options: KeyedBatchOptions<TInput, TOutput>
): Promise<Array<KeyedBatchTaskResult<TOutput>>> {
  if (tasks.length === 0) return []

  const concurrency = normalizeBatchConcurrency(options.concurrency, tasks.length)
  const results: Array<KeyedBatchTaskResult<TOutput> | undefined> = Array(tasks.length)
  const pending = new Set(tasks.map((_, index) => index))
  const activeKeys = new Set<string>()
  let activeCount = 0
  let exclusiveActive = false

  return new Promise((resolve) => {
    const finishIfDone = () => {
      if (activeCount !== 0 || pending.size !== 0) return false
      options.signal?.removeEventListener('abort', schedule)
      resolve(results as Array<KeyedBatchTaskResult<TOutput>>)
      return true
    }

    const cancelPending = () => {
      if (!options.signal?.aborted) return
      for (const index of pending) {
        pending.delete(index)
        const result = { status: 'cancelled' as const }
        results[index] = result
        options.onTaskComplete?.(tasks[index].value, index, result)
      }
    }

    const findRunnableIndex = (): number | undefined => {
      if (exclusiveActive) return undefined
      for (const index of pending) {
        const task = tasks[index]
        if (task.exclusive) return activeCount === 0 ? index : undefined
        if (!activeKeys.has(task.key)) return index
      }
      return undefined
    }

    function schedule(): void {
      cancelPending()
      if (finishIfDone()) return

      while (activeCount < concurrency && !options.signal?.aborted) {
        const index = findRunnableIndex()
        if (index === undefined) break

        const task = tasks[index]
        pending.delete(index)
        activeCount++
        activeKeys.add(task.key)
        if (task.exclusive) exclusiveActive = true
        options.onTaskStart?.(task.value, index)

        void Promise.resolve()
          .then(() => options.run(task.value, index))
          .then(
            (value) => ({ status: 'success' as const, value }),
            (error) => ({
              status: 'failed' as const,
              error: error instanceof Error ? error.message : String(error),
            })
          )
          .then((result) => {
            results[index] = result
            options.onTaskComplete?.(task.value, index, result)
          })
          .finally(() => {
            activeCount--
            activeKeys.delete(task.key)
            if (task.exclusive) exclusiveActive = false
            schedule()
          })
      }
    }

    options.signal?.addEventListener('abort', schedule, { once: true })
    schedule()
  })
}
import { cpus, totalmem } from 'node:os'
