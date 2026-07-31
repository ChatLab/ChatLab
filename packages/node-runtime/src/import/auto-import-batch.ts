import { resolveAutoImportTargetPlan, type AutoImportDecision, type AutoImportTargetPlan } from './auto-import-matcher'
import { autoImportFile, type AutoImportDeps, type AutoImportOptions, type AutoImportResult } from './auto-importer'
import { normalizeBatchConcurrency, runKeyedBatch, type KeyedBatchTaskResult } from './batch-coordinator'
import type { ImportProgressCallback } from './streaming-importer'
import { appLogger } from '../logging/app-logger'

export interface AutoImportBatchItem {
  id: string
  filePath: string
  options?: AutoImportOptions
}

export type AutoImportBatchItemResult =
  | { id: string; status: 'success'; result: AutoImportResult }
  | { id: string; status: 'failed'; error: string; result?: AutoImportResult }
  | { id: string; status: 'cancelled' }

export interface AutoImportBatchOptions {
  concurrency?: number
  signal?: AbortSignal
  onItemStart?: (item: AutoImportBatchItem, index: number) => void
  onItemProgress?: (item: AutoImportBatchItem, index: number, progress: Parameters<ImportProgressCallback>[0]) => void
  onItemComplete?: (item: AutoImportBatchItem, index: number, result: AutoImportBatchItemResult) => void
  resolveTargetPlan?: typeof resolveAutoImportTargetPlan
}

interface PlannedItem {
  item: AutoImportBatchItem
  itemIndex: number
  plan: AutoImportTargetPlan
}

function mapTaskResult(
  item: AutoImportBatchItem,
  result: KeyedBatchTaskResult<AutoImportResult>
): AutoImportBatchItemResult {
  if (result.status === 'cancelled') return { id: item.id, status: 'cancelled' }
  if (result.status === 'failed') return { id: item.id, status: 'failed', error: result.error }
  if (!result.value.success) {
    return {
      id: item.id,
      status: 'failed',
      error: result.value.error ?? 'Import failed',
      result: result.value,
    }
  }
  return { id: item.id, status: 'success', result: result.value }
}

function preserveSerialTargetMatching(planned: PlannedItem[]): void {
  let priorPlannedWrite = false

  for (const plannedItem of planned) {
    let plan = plannedItem.plan
    if (priorPlannedWrite && !plannedItem.item.options?.explicitSessionId && !plan.exclusive) {
      plan = {
        ...plan,
        concurrencyKey: `unresolved:${plannedItem.itemIndex}`,
        exclusive: true,
        coalesceCreate: false,
      }
    }

    plannedItem.plan = plan
    priorPlannedWrite = true
  }
}

export async function autoImportBatch(
  items: AutoImportBatchItem[],
  deps: AutoImportDeps,
  options: AutoImportBatchOptions = {}
): Promise<AutoImportBatchItemResult[]> {
  if (items.length === 0) return []

  const resolvePlan = options.resolveTargetPlan ?? resolveAutoImportTargetPlan
  const concurrency = normalizeBatchConcurrency(options.concurrency, items.length)
  appLogger.info('import-batch', 'Batch import started', {
    itemCount: items.length,
    concurrency,
  })
  const preflight = await runKeyedBatch(
    items.map((item, index) => ({ value: { item, itemIndex: index }, key: `preflight:${index}` })),
    {
      concurrency,
      signal: options.signal,
      run: async ({ item, itemIndex }) => {
        const itemOptions = item.options ?? {}
        if (itemOptions.explicitSessionId) {
          const sessionId = itemOptions.explicitSessionId
          const decision: AutoImportDecision = deps.sessionExists(sessionId)
            ? { action: 'incremental', sessionId, matchedBy: 'source-session-id' }
            : { action: 'create', reason: 'no-match' }
          return {
            item,
            itemIndex,
            plan: {
              decision,
              concurrencyKey: `session:${sessionId}`,
              exclusive: false,
              coalesceCreate: decision.action === 'create',
            },
          } satisfies PlannedItem
        }
        return {
          item,
          itemIndex,
          plan: await resolvePlan(
            item.filePath,
            {
              ...deps,
              onProgress: (progress) => options.onItemProgress?.(item, itemIndex, progress),
            },
            itemOptions.formatOptions
          ),
        } satisfies PlannedItem
      },
    }
  )

  const finalResults: Array<AutoImportBatchItemResult | undefined> = Array(items.length)
  const planned: PlannedItem[] = []
  for (let index = 0; index < preflight.length; index++) {
    const result = preflight[index]
    if (result.status === 'success') {
      planned.push(result.value)
      continue
    }
    const mapped: AutoImportBatchItemResult =
      result.status === 'cancelled'
        ? { id: items[index].id, status: 'cancelled' }
        : { id: items[index].id, status: 'failed', error: result.error }
    finalResults[index] = mapped
    options.onItemComplete?.(items[index], index, mapped)
  }

  preserveSerialTargetMatching(planned)
  const targetSessionByKey = new Map<string, string>()
  await runKeyedBatch<PlannedItem, AutoImportResult>(
    planned.map((plannedItem) => ({
      value: plannedItem,
      key: plannedItem.plan.concurrencyKey,
      exclusive: plannedItem.plan.exclusive,
    })),
    {
      concurrency,
      signal: options.signal,
      onTaskStart: ({ item, itemIndex }) => options.onItemStart?.(item, itemIndex),
      onTaskComplete: ({ item, itemIndex }, _plannedIndex, taskResult) => {
        const mapped = mapTaskResult(item, taskResult)
        finalResults[itemIndex] = mapped
        options.onItemComplete?.(item, itemIndex, mapped)
      },
      run: async ({ item, itemIndex, plan }) => {
        const targetSessionId = plan.coalesceCreate ? targetSessionByKey.get(plan.concurrencyKey) : undefined
        const decision: AutoImportDecision = targetSessionId
          ? { action: 'incremental', sessionId: targetSessionId, matchedBy: 'trailing-messages' }
          : plan.decision
        const result = await autoImportFile(
          item.filePath,
          {
            ...deps,
            onProgress: (progress) => options.onItemProgress?.(item, itemIndex, progress),
          },
          {
            ...item.options,
            resolvedDecision:
              plan.exclusive || (item.options?.explicitSessionId && !targetSessionId) ? undefined : decision,
          }
        )
        if (!plan.exclusive && result.success && result.sessionId) {
          targetSessionByKey.set(plan.concurrencyKey, result.sessionId)
        }
        return result
      },
    }
  )

  const completedResults = finalResults as AutoImportBatchItemResult[]
  appLogger.info('import-batch', 'Batch import completed', {
    itemCount: items.length,
    successCount: completedResults.filter((result) => result.status === 'success').length,
    failedCount: completedResults.filter((result) => result.status === 'failed').length,
    cancelledCount: completedResults.filter((result) => result.status === 'cancelled').length,
  })
  return completedResults
}
