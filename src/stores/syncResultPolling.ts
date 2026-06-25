interface SyncSessionState {
  id: string
  targetSessionId: string
  lastPullAt: number
  lastStatus: 'idle' | 'success' | 'error'
  lastNewMessages: number
}

interface SyncSourceState {
  id: string
  sessions: SyncSessionState[]
}

export interface SyncResultPollerOptions {
  loadDataSources: () => Promise<SyncSourceState[]>
  onResult: () => void | Promise<void>
  intervalMs?: number
  schedule?: (callback: () => void, intervalMs: number) => unknown
  cancelSchedule?: (timer: unknown) => void
}

function buildSessionStateMap(sources: SyncSourceState[]): Map<string, string> {
  const states = new Map<string, string>()
  for (const source of sources) {
    for (const session of source.sessions) {
      states.set(
        `${source.id}:${session.id}`,
        JSON.stringify([session.targetSessionId, session.lastPullAt, session.lastStatus, session.lastNewMessages])
      )
    }
  }
  return states
}

/**
 * CLI Web 没有 Electron IPC 推送，因此通过持久化的订阅状态检测后台同步完成。
 * 不依赖短暂的 progress 记录，浏览器后台节流后恢复也能发现遗漏的完成事件。
 */
export function createSyncResultPoller(options: SyncResultPollerOptions): () => void {
  const schedule = options.schedule ?? ((callback, intervalMs) => setInterval(callback, intervalMs))
  const cancelSchedule = options.cancelSchedule ?? ((timer) => clearInterval(timer as ReturnType<typeof setInterval>))
  let previousStates: Map<string, string> | null = null
  let stopped = false
  let polling = false

  const poll = async () => {
    if (stopped || polling) return
    polling = true
    try {
      const sources = await options.loadDataSources()
      if (stopped) return

      const nextStates = buildSessionStateMap(sources)
      if (previousStates) {
        const completed = sources.some((source) =>
          source.sessions.some((session) => {
            const key = `${source.id}:${session.id}`
            return session.lastStatus !== 'idle' && previousStates?.get(key) !== nextStates.get(key)
          })
        )
        if (completed) await options.onResult()
      }
      previousStates = nextStates
    } catch {
      // 临时请求失败时保留旧基线，下次成功轮询仍可检测期间发生的同步结果。
    } finally {
      polling = false
    }
  }

  void poll()
  const timer = schedule(() => void poll(), options.intervalMs ?? 5000)

  return () => {
    stopped = true
    cancelSchedule(timer)
  }
}
