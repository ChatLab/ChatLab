import type { ToolProgress } from '@openchatlab/shared-types'

export interface ToolStatus {
  name: string
  displayName: string
  status: 'running' | 'done' | 'error'
  toolCallId?: string
  progress?: ToolProgress
  result?: unknown
}

interface ToolIdentity {
  name: string
  toolCallId?: string
}

function getToolKey(tool: ToolIdentity): string {
  return tool.toolCallId ? `id:${tool.toolCallId}` : `name:${tool.name}`
}

export function createToolLifecycleTracker() {
  const activeTools = new Map<string, ToolStatus>()
  let currentKey: string | null = null

  const getCurrentActive = (): ToolStatus | null => {
    if (currentKey) {
      const current = activeTools.get(currentKey)
      if (current) return current
    }
    const fallback = Array.from(activeTools.entries()).at(-1)
    currentKey = fallback?.[0] ?? null
    return fallback?.[1] ?? null
  }

  return {
    start(tool: ToolIdentity): ToolStatus {
      const key = getToolKey(tool)
      const status: ToolStatus = {
        name: tool.name,
        displayName: tool.name,
        status: 'running',
        toolCallId: tool.toolCallId,
      }
      activeTools.set(key, status)
      currentKey = key
      return status
    },

    update(tool: ToolIdentity & { progress: ToolProgress }): ToolStatus | null {
      const key = getToolKey(tool)
      const current = activeTools.get(key)
      if (!current) return getCurrentActive()

      const updated = { ...current, progress: tool.progress }
      activeTools.set(key, updated)
      currentKey = key
      return updated
    },

    finish(tool: ToolIdentity & { status: 'done' | 'error' }): ToolStatus | null {
      const key = getToolKey(tool)
      const finished = activeTools.get(key)
      activeTools.delete(key)

      if (currentKey === key) currentKey = null
      const remaining = getCurrentActive()
      if (remaining) return remaining
      return finished ? { ...finished, status: tool.status } : null
    },

    current(): ToolStatus | null {
      return getCurrentActive()
    },

    clear(): void {
      activeTools.clear()
      currentKey = null
    },
  }
}
