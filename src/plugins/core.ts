import type { RuntimePlatform } from '@/utils/platform-capabilities'

export type Disposer = () => void

export class DisposableStore {
  private readonly disposers: Disposer[] = []
  private disposed = false

  add(disposer: Disposer): Disposer {
    if (this.disposed) {
      disposer()
      throw new Error('DisposableStore is already disposed')
    }
    this.disposers.push(disposer)
    return disposer
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    const errors: unknown[] = []
    for (let index = this.disposers.length - 1; index >= 0; index--) {
      try {
        this.disposers[index]?.()
      } catch (error) {
        errors.push(error)
      }
    }
    this.disposers.length = 0

    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, 'Multiple plugin disposers failed')
  }
}

interface ContributionRecord<T> {
  owner: string
  value: T
}

export class ContributionRegistry<T extends { id: string }> {
  private readonly records = new Map<string, ContributionRecord<T>>()

  register(owner: string, contribution: T): Disposer {
    const contributionId = contribution.id
    const existing = this.records.get(contributionId)
    if (existing) {
      throw new Error(`Contribution "${contributionId}" is already registered by plugin "${existing.owner}"`)
    }

    const record = { owner, value: contribution }
    this.records.set(contributionId, record)

    return () => {
      if (this.records.get(contributionId) === record) this.records.delete(contributionId)
    }
  }

  get(id: string): T | undefined {
    return this.records.get(id)?.value
  }

  list(): T[] {
    return [...this.records.values()].map(({ value }) => value)
  }
}

export interface ChatLabPlugin<TContext> {
  id: string
  platforms: readonly RuntimePlatform[]
  activate(context: TContext): void | Disposer
}

export interface PluginContextFactory<TContext> {
  (pluginId: string, disposables: DisposableStore): TContext
}

export class PluginHost<TContext> {
  private readonly activePlugins = new Map<string, DisposableStore>()

  constructor(
    private readonly platform: RuntimePlatform,
    private readonly createContext: PluginContextFactory<TContext>
  ) {}

  activate(plugin: ChatLabPlugin<TContext>): boolean {
    if (!plugin.platforms.includes(this.platform)) return false
    if (this.activePlugins.has(plugin.id)) throw new Error(`Plugin "${plugin.id}" is already active`)

    const disposables = new DisposableStore()
    try {
      const pluginDisposer = plugin.activate(this.createContext(plugin.id, disposables))
      if (pluginDisposer) disposables.add(pluginDisposer)
      this.activePlugins.set(plugin.id, disposables)
      return true
    } catch (error) {
      try {
        disposables.dispose()
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Plugin "${plugin.id}" activation and rollback failed`)
      }
      throw error
    }
  }

  isActive(pluginId: string): boolean {
    return this.activePlugins.has(pluginId)
  }

  addDisposer(pluginId: string, disposer: Disposer): void {
    const disposables = this.activePlugins.get(pluginId)
    if (!disposables) {
      disposer()
      throw new Error(`Plugin "${pluginId}" is not active`)
    }
    disposables.add(disposer)
  }

  dispose(pluginId: string): void {
    const disposables = this.activePlugins.get(pluginId)
    if (!disposables) return
    this.activePlugins.delete(pluginId)
    disposables.dispose()
  }

  disposeAll(): void {
    const pluginIds = [...this.activePlugins.keys()]
    const errors: unknown[] = []
    for (let index = pluginIds.length - 1; index >= 0; index--) {
      try {
        this.dispose(pluginIds[index]!)
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, 'Multiple plugins failed to dispose')
  }
}
