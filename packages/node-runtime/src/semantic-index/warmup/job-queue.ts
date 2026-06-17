/**
 * 语义索引串行 job 队列（Phase 1 simple runner）
 *
 * chunking-decision-final.md 第 15 节：build/rebuild/cleanup 任务串行处理，避免 CPU、
 * 内存、API 请求和 SQLite 写入竞争；支持按对话暂停、取消、续跑；失败保留已完成部分。
 *
 * 本队列只负责调度与停止信号管理，具体执行（读库/embedding/写入）由注入的 executor
 * 完成。队列不持久化；重启后的恢复由 service 层扫描业务状态表（权威来源）重新入队驱动。
 */

import type { StopSignal } from './runner'

export type SemanticIndexJobType = 'build' | 'rebuild' | 'cleanup'

export interface SemanticIndexJob {
  type: SemanticIndexJobType
  dbPathHash: string
}

export interface JobContext {
  job: SemanticIndexJob
  /** executor 应将其传入 runWarmup；返回 'paused'/'cancelled' 时应停止 */
  checkStop: StopSignal
}

export type JobExecutor = (ctx: JobContext) => Promise<void>

type StopState = null | 'paused' | 'cancelled'

export class SemanticIndexJobQueue {
  private executor: JobExecutor
  private pending: SemanticIndexJob[] = []
  private processing = false
  private currentHash: string | null = null
  private stopState: StopState = null
  private idleResolvers: (() => void)[] = []

  constructor(executor: JobExecutor) {
    this.executor = executor
  }

  /** 入队；同一对话 + 同类型的待处理任务去重 */
  enqueue(job: SemanticIndexJob): void {
    const duplicate = this.pending.some((j) => j.dbPathHash === job.dbPathHash && j.type === job.type)
    if (duplicate) return
    this.pending.push(job)
    void this.process()
  }

  /** 暂停指定对话：停止其正在运行的任务并移除其待处理任务（不自动续跑） */
  pause(dbPathHash: string): void {
    this.removePending(dbPathHash)
    if (this.currentHash === dbPathHash) this.stopState = 'paused'
  }

  /** 取消指定对话：停止其正在运行的任务并移除其待处理任务 */
  cancel(dbPathHash: string): void {
    this.removePending(dbPathHash)
    if (this.currentHash === dbPathHash) this.stopState = 'cancelled'
  }

  isRunning(dbPathHash: string): boolean {
    return this.currentHash === dbPathHash
  }

  isQueued(dbPathHash: string): boolean {
    return this.currentHash === dbPathHash || this.pending.some((j) => j.dbPathHash === dbPathHash)
  }

  /** 等待队列清空（含当前任务） */
  whenIdle(): Promise<void> {
    if (!this.processing && this.pending.length === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleResolvers.push(resolve))
  }

  private removePending(dbPathHash: string): void {
    this.pending = this.pending.filter((j) => j.dbPathHash !== dbPathHash)
  }

  private async process(): Promise<void> {
    if (this.processing) return
    this.processing = true

    while (this.pending.length > 0) {
      const job = this.pending.shift()!
      this.currentHash = job.dbPathHash
      this.stopState = null
      try {
        await this.executor({ job, checkStop: () => this.stopState })
      } catch {
        // executor 内部负责把失败写入业务状态；队列继续处理后续任务
      }
      this.currentHash = null
      this.stopState = null
    }

    this.processing = false
    const resolvers = this.idleResolvers
    this.idleResolvers = []
    for (const resolve of resolvers) resolve()
  }
}
