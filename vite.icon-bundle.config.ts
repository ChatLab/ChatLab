import { NuxtIconBundle } from '@nuxt/icon/vite'
import type { PluginOption } from 'vite'

/** Bundle every icon used by ChatLab and Nuxt UI so rendering never depends on an icon CDN. */
export function chatlabIconBundle(rootDir: string): PluginOption {
  return NuxtIconBundle({
    cwd: rootDir,
    scan: {
      globInclude: [
        'src/**/*.{vue,ts,tsx}',
        'apps/web-wasm/src/**/*.{vue,ts,tsx}',
        'node_modules/@nuxt/ui/dist/**/*.{vue,js,mjs,ts}',
      ],
      globExclude: [],
    },
  })
}
