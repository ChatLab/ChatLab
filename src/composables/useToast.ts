import { useToast as useNuxtToast } from '@nuxt/ui/composables'

type ToastPayload = {
  title: string
  color?: 'primary' | 'success' | 'warning' | 'error' | 'neutral'
  description?: string
  duration?: number
  actions?: Array<{ label: string; icon?: string; onClick: () => void }>
}

const DEFAULT_DURATION = 2000

export function useToast() {
  const toast = useNuxtToast()
  const add = (payload: ToastPayload) => toast.add({ duration: DEFAULT_DURATION, ...payload })
  return {
    add,
    success: (title: string, opts: Omit<ToastPayload, 'title' | 'color'> = {}) =>
      add({ title, color: 'success', ...opts }),
    fail: (title: string, opts: Omit<ToastPayload, 'title' | 'color'> = {}) => add({ title, color: 'error', ...opts }),
    info: (title: string, opts: Omit<ToastPayload, 'title' | 'color'> = {}) =>
      add({ title, color: 'primary', ...opts }),
    warn: (title: string, opts: Omit<ToastPayload, 'title' | 'color'> = {}) =>
      add({ title, color: 'warning', ...opts }),
  }
}
