/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // 使用 Record<string, never> 避免 {} 被 ESLint 判定为过宽类型。
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
