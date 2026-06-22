import type { RuntimeIdentity } from '../data-dir-compat'
import { DatabaseManager } from '../database-manager'
import { createDatabaseManagerAdapter } from '../services'
import { createSemanticIndexService } from './service'
import type { LoadSqliteVec } from './store'
import { StaticPathProvider, type StaticPathProviderSnapshot } from './static-path-provider'
import type { SemanticIndexRuntime } from './runtime'

export interface SemanticIndexWorkerStartupOptions {
  paths: StaticPathProviderSnapshot
  runtime: RuntimeIdentity
  nativeBinding?: string
  sqliteVecLoadablePath?: string
}

export type SemanticIndexWorkerServiceFactory = () => SemanticIndexRuntime

export interface SemanticIndexWorkerRuntimeOptions {
  serviceFactory: SemanticIndexWorkerServiceFactory
}

export class SemanticIndexWorkerRuntime {
  private service: SemanticIndexRuntime | null = null
  private readonly options: SemanticIndexWorkerRuntimeOptions

  constructor(options: SemanticIndexWorkerRuntimeOptions) {
    this.options = options
  }

  async handleRequest(method: string, args: unknown[]): Promise<unknown> {
    if (method === '__close') {
      await this.close()
      return null
    }
    const service = this.ensureService()
    const target = service as unknown as Record<string, (...args: unknown[]) => unknown>
    const fn = target[method]
    if (typeof fn !== 'function') throw new Error(`Unsupported semantic index worker method: ${method}`)
    return await fn.apply(service, args)
  }

  async close(): Promise<void> {
    const service = this.service
    this.service = null
    await service?.close()
  }

  private ensureService(): SemanticIndexRuntime {
    if (!this.service) {
      this.service = this.options.serviceFactory()
      void this.service.recover()
    }
    return this.service
  }
}

export function createSemanticIndexWorkerRuntime(
  options: SemanticIndexWorkerRuntimeOptions
): SemanticIndexWorkerRuntime {
  return new SemanticIndexWorkerRuntime(options)
}

export function createSemanticIndexWorkerServiceFactory(
  options: SemanticIndexWorkerStartupOptions
): SemanticIndexWorkerServiceFactory {
  return () => {
    const pathProvider = new StaticPathProvider(options.paths)
    const dbManager = new DatabaseManager(pathProvider, {
      nativeBinding: options.nativeBinding,
      runtime: options.runtime,
    })
    const sessionAdapter = createDatabaseManagerAdapter(dbManager)
    const loadSqliteVec: LoadSqliteVec | undefined = options.sqliteVecLoadablePath
      ? (db) => db.loadExtension(options.sqliteVecLoadablePath!)
      : undefined

    return createSemanticIndexService({
      pathProvider,
      sessionAdapter,
      nativeBinding: options.nativeBinding,
      loadSqliteVec,
    })
  }
}
