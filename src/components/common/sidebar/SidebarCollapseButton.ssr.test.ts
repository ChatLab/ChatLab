import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { renderToString } from '@vue/server-renderer'
import vue from '@vitejs/plugin-vue'
import { createSSRApp, defineComponent, h, type Component } from 'vue'
import { createServer, type ViteDevServer } from 'vite'

let server: ViteDevServer
let SidebarCollapseButton: Component

const UButtonStub = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h('button', attrs, [slots.leading?.(), slots.default?.()])
  },
})

before(async () => {
  server = await createServer({
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    plugins: [vue()],
  })
  SidebarCollapseButton = (await server.ssrLoadModule('/src/components/common/sidebar/SidebarCollapseButton.vue'))
    .default as Component
})

after(async () => {
  await server.close()
})

async function renderCollapseButton(collapsed: boolean): Promise<string> {
  const app = createSSRApp({
    render: () =>
      h(SidebarCollapseButton, {
        collapsed,
        accessibleLabel: collapsed ? 'Expand sidebar' : 'Collapse sidebar',
      }),
  })
  app.component('UButton', UButtonStub)
  app.component(
    'UIcon',
    defineComponent(() => () => h('span'))
  )
  return renderToString(app)
}

describe('SidebarCollapseButton rendered contract', () => {
  it('keeps both sidebar states keyboard-accessible', async () => {
    const expandedHtml = await renderCollapseButton(false)
    const collapsedHtml = await renderCollapseButton(true)

    assert.match(expandedHtml, /<button/)
    assert.match(expandedHtml, /aria-label="Collapse sidebar"/)
    assert.match(expandedHtml, /aria-expanded="true"/)
    assert.match(collapsedHtml, /<button/)
    assert.match(collapsedHtml, /aria-label="Expand sidebar"/)
    assert.match(collapsedHtml, /aria-expanded="false"/)
  })
})
