import { computed, inject, provide, shallowRef, type ComputedRef, type InjectionKey } from 'vue'

export type PeopleSubpage = 'contacts' | 'relationships'

export interface PeoplePageHeaderAction {
  label: string
  icon: string
  loading: boolean
  disabled: boolean
  class?: string
  onClick: () => void | Promise<void>
}

export interface PeoplePageHeaderStat {
  id: string
  label: string
  value: string | number
  dividerBefore?: boolean
}

export interface PeoplePageHeaderConfig {
  title: string
  description?: string
  icon: string
  iconClass: string
  action?: PeoplePageHeaderAction | null
  stats?: PeoplePageHeaderStat[]
}

interface PeoplePageHeaderContext {
  setHeader: (config: ComputedRef<PeoplePageHeaderConfig>) => void
}

const PEOPLE_PAGE_HEADER_KEY: InjectionKey<PeoplePageHeaderContext> = Symbol('PeoplePageHeader')

export function providePeoplePageHeader(defaultHeader: ComputedRef<PeoplePageHeaderConfig>) {
  const registeredHeader = shallowRef<ComputedRef<PeoplePageHeaderConfig> | null>(null)
  const header = computed(() => registeredHeader.value?.value ?? defaultHeader.value)

  function setHeader(config: ComputedRef<PeoplePageHeaderConfig>) {
    registeredHeader.value = config
  }

  provide(PEOPLE_PAGE_HEADER_KEY, { setHeader })

  return {
    header,
  }
}

export function usePeoplePageHeader(config: ComputedRef<PeoplePageHeaderConfig>) {
  // 父路由持有真实 Header 节点，子页只注册当前页面需要展示的标题、操作和统计信息。
  inject(PEOPLE_PAGE_HEADER_KEY)?.setHeader(config)
}
