import type { Disposer } from './core'
import type { InsightScope } from './insight-scope'
import type { LocaleService } from './locale'

export type { LocaleService } from './locale'

declare const uiServiceType: unique symbol

export interface UiServiceKey<T> {
  id: string
  readonly [uiServiceType]?: T
}

export function createUiServiceKey<T>(id: string): UiServiceKey<T> {
  return { id }
}

export interface UiServiceProvider {
  get<T>(key: UiServiceKey<T>): T
}

export interface UiServiceRegistrar {
  register<T>(key: UiServiceKey<T>, service: T): Disposer
}

export class UiServiceRegistry implements UiServiceProvider, UiServiceRegistrar {
  private readonly services = new Map<string, unknown>()

  register<T>(key: UiServiceKey<T>, service: T): Disposer {
    if (this.services.has(key.id)) throw new Error(`UI host service "${key.id}" is already registered`)
    this.services.set(key.id, service)
    return () => {
      if (this.services.get(key.id) === service) this.services.delete(key.id)
    }
  }

  get<T>(key: UiServiceKey<T>): T {
    if (!this.services.has(key.id)) throw new Error(`UI host service "${key.id}" is unavailable`)
    return this.services.get(key.id) as T
  }
}

export interface UiHostContext {
  locale: LocaleService
  insightScope: InsightScope
  services: UiServiceProvider
}
