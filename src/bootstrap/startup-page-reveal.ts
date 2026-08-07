import type { InjectionKey, Ref } from 'vue'

export const STARTUP_PAGE_REVEAL_READY_KEY: InjectionKey<Readonly<Ref<boolean>>> = Symbol('startup-page-reveal-ready')
