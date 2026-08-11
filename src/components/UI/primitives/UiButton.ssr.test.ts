import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { renderToString } from '@vue/server-renderer'
import vue from '@vitejs/plugin-vue'
import { createSSRApp, defineComponent, h, type Component } from 'vue'
import { createServer, type ViteDevServer } from 'vite'

let server: ViteDevServer
let UiButton: Component

const UButtonStub = defineComponent({
  inheritAttrs: false,
  props: {
    label: String,
    loading: Boolean,
    disabled: Boolean,
  },
  setup(props, { attrs, slots }) {
    return () =>
      h(
        'button',
        {
          ...attrs,
          disabled: props.disabled,
          'data-loading': props.loading ? 'true' : undefined,
        },
        slots.default?.() ?? props.label
      )
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
  UiButton = (await server.ssrLoadModule('/src/components/UI/primitives/UiButton.vue')).default as Component
})

after(async () => {
  await server.close()
})

async function renderButton(props: Record<string, unknown>, text?: string): Promise<string> {
  const app = createSSRApp({
    render: () => h(UiButton, props, text === undefined ? undefined : { default: () => text }),
  })
  app.component('UButton', UButtonStub)
  return renderToString(app)
}

describe('UiButton rendered contract', () => {
  it('renders its explicit accessible label and strips vendor escape hatches', async () => {
    const html = await renderButton({
      icon: 'i-heroicons-x-mark',
      accessibleLabel: 'Close',
      ui: { base: 'vendor-override' },
      portal: false,
    })

    assert.match(html, /aria-label="Close"/)
    assert.doesNotMatch(html, /vendor-override|portal=/)
  })

  it('rejects icon-only buttons without an explicit accessible label', async () => {
    await assert.rejects(() => renderButton({ icon: 'i-heroicons-x-mark' }), /visible text or an accessible label/)
    await assert.rejects(
      () => renderButton({ icon: 'i-heroicons-x-mark', 'aria-label': 'Bypassed label' }),
      /visible text or an accessible label/
    )
  })

  it('renders visible slot text as the button name', async () => {
    const html = await renderButton({}, 'Retry')
    assert.match(html, /Retry/)
  })

  it('keeps disabled and loading buttons non-interactive', async () => {
    const disabledHtml = await renderButton({ label: 'Disabled', disabled: true })
    const loadingHtml = await renderButton({ label: 'Loading', loading: true })

    assert.match(disabledHtml, /disabled/)
    assert.match(loadingHtml, /disabled/)
    assert.match(loadingHtml, /aria-busy="true"/)
    assert.match(loadingHtml, /data-loading="true"/)
  })
})
