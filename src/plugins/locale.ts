import type { LocaleType } from '@/i18n'
import type { Disposer } from './core'

export const PLUGIN_LOCALE_FALLBACK: LocaleType = 'en-US'
export const PLUGIN_LOCALES = ['en-US', 'zh-CN', 'zh-TW', 'ja-JP'] as const satisfies readonly LocaleType[]

export interface LocaleSnapshot {
  locale: LocaleType
  revision: number
}

export interface LocalizedText {
  key: string
  namespace?: string
}

export type LocaleParams = Readonly<Record<string, unknown>>
export type PluginTranslate<TKey extends string = string> = (key: TKey, params?: LocaleParams) => string
export type PluginLocaleDictionary<TKey extends string = string> = Readonly<Record<TKey, string>>
export type PluginLocaleMessages<TKey extends string = string> = Readonly<
  Record<LocaleType, PluginLocaleDictionary<TKey>>
>

export interface LocaleService {
  getSnapshot(): LocaleSnapshot
  subscribe(listener: () => void): Disposer
  translate(text: string | LocalizedText, params?: LocaleParams): string
  bind<TKey extends string = string>(namespace: string): PluginTranslate<TKey>
  formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string
}

export interface PluginLocaleRegistry {
  register<TKey extends string>(ownerId: string, namespace: string, messages: PluginLocaleMessages<TKey>): Disposer
}

export interface LocaleHostAdapter {
  getLocale(): LocaleType
  subscribe(listener: () => void): Disposer
  translate(key: string, params?: LocaleParams): string
}

interface LocaleRegistration {
  ownerId: string
  messages: PluginLocaleMessages
}

export class PluginLocaleHost implements LocaleService, PluginLocaleRegistry {
  private readonly registrations = new Map<string, LocaleRegistration>()
  private readonly listeners = new Set<() => void>()
  private readonly stopAdapterSubscription: Disposer
  private revision = 0

  constructor(private readonly adapter: LocaleHostAdapter) {
    this.stopAdapterSubscription = adapter.subscribe(() => this.publish())
  }

  getSnapshot(): LocaleSnapshot {
    return { locale: this.adapter.getLocale(), revision: this.revision }
  }

  subscribe(listener: () => void): Disposer {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  register<TKey extends string>(ownerId: string, namespace: string, messages: PluginLocaleMessages<TKey>): Disposer {
    const expectedNamespace = `plugins.${ownerId}`
    if (namespace !== expectedNamespace) {
      throw new Error(`Plugin "${ownerId}" must register locale namespace "${expectedNamespace}"`)
    }

    const existing = this.registrations.get(namespace)
    if (existing) {
      throw new Error(`Locale namespace "${namespace}" is already registered by plugin "${existing.ownerId}"`)
    }

    validateMessages(namespace, messages)
    const registration: LocaleRegistration = { ownerId, messages }
    this.registrations.set(namespace, registration)
    this.publish()

    return () => {
      if (this.registrations.get(namespace) !== registration) return
      this.registrations.delete(namespace)
      this.publish()
    }
  }

  translate(text: string | LocalizedText, params?: LocaleParams): string {
    if (typeof text === 'string' || !text.namespace) {
      return this.adapter.translate(typeof text === 'string' ? text : text.key, params)
    }
    return this.translatePlugin(text.namespace, text.key, params)
  }

  bind<TKey extends string = string>(namespace: string): PluginTranslate<TKey> {
    return (key, params) => this.translatePlugin(namespace, key, params)
  }

  formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat(this.adapter.getLocale(), options).format(value)
  }

  formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this.adapter.getLocale(), options).format(value)
  }

  dispose(): void {
    this.stopAdapterSubscription()
    this.registrations.clear()
    this.listeners.clear()
  }

  private translatePlugin(namespace: string, key: string, params?: LocaleParams): string {
    if (key.startsWith('common.')) return this.adapter.translate(key, params)

    const registration = this.registrations.get(namespace)
    if (!registration) return key
    const locale = this.adapter.getLocale()
    const message = registration.messages[locale][key] ?? registration.messages[PLUGIN_LOCALE_FALLBACK][key]
    return message === undefined ? key : interpolate(message, params)
  }

  private publish(): void {
    this.revision++
    for (const listener of this.listeners) listener()
  }
}

function validateMessages<TKey extends string>(namespace: string, messages: PluginLocaleMessages<TKey>): void {
  const expectedKeys = Object.keys(messages[PLUGIN_LOCALE_FALLBACK]).sort()
  for (const locale of PLUGIN_LOCALES) {
    const actualKeys = Object.keys(messages[locale]).sort()
    if (actualKeys.length === expectedKeys.length && actualKeys.every((key, index) => key === expectedKeys[index])) {
      continue
    }
    throw new Error(`Locale namespace "${namespace}" must define the same keys for every supported locale (${locale})`)
  }
}

function interpolate(message: string, params?: LocaleParams): string {
  if (!params) return message
  return message.replace(/\{([^{}]+)\}/g, (placeholder, key: string) => {
    const value = params[key]
    return value === undefined || value === null ? placeholder : String(value)
  })
}
