export interface AutomationDataSourceLike {
  id: string
  sessions: Array<{ id: string; targetSessionId?: string | null }>
}

export interface AutomationRouteContext {
  dsManager: {
    loadAll: () => unknown[]
    get: (id: string) => AutomationDataSourceLike | null | undefined
    add: (source: {
      name?: string
      baseUrl: string
      token: string
      intervalMinutes: number
      pullLimit?: number
    }) => unknown
    update: (
      id: string,
      updates: {
        name?: string
        baseUrl?: string
        token?: string
        intervalMinutes?: number
        pullLimit?: number
        enabled?: boolean
      }
    ) => unknown | null
    delete: (id: string) => boolean
    addSessions: (sourceId: string, sessions: Array<{ name: string; remoteSessionId: string }>) => unknown[]
    removeSession: (sourceId: string, sessionId: string) => { targetSessionId?: string | null } | null | undefined
  }
  pullEngine: {
    triggerPull: (sourceId: string, sessionId?: string) => Promise<unknown>
    triggerPullAll: (sourceId: string) => Promise<unknown>
    getProgress: () => unknown[]
  }
  serverInfo?: { port: number; host: string; token: string }
  deleteSessionData?: (sessionId: string) => void
  reloadTimer?: (sourceId: string, immediate?: boolean) => void
  stopTimer?: (sourceId: string) => void
}

export interface AutomationRouteHostContext {
  automation?: AutomationRouteContext
}
