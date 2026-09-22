import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { describe, it } from 'node:test'
import * as Vue from 'vue'
import { compileTemplate, parse } from 'vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'

for (const chatType of ['group', 'private']) {
  describe(`${chatType} chat page time filter`, () => {
    async function renderChat(timeFilter?: { startTs: number; endTs: number }) {
      const filename = new URL(`./${chatType}-chat/index.vue`, import.meta.url)
      const { descriptor } = parse(readFileSync(filename, 'utf8'))
      // Compile the real page's ChatExplorer binding while isolating unrelated UI and services.
      const chatTemplate = descriptor.template!.content.match(/<ChatExplorer\b[\s\S]*?\/>/)?.[0]
      assert.ok(chatTemplate)
      const compiled = compileTemplate({
        source: chatTemplate.replace('v-else-if=', 'v-if='),
        filename: filename.pathname,
        id: chatType,
        compilerOptions: { mode: 'function', prefixIdentifiers: true, expressionPlugins: ['typescript'] },
      })
      assert.deepEqual(compiled.errors, [])
      const factory = stripTypeScriptTypes(`function createRender(Vue) { ${compiled.code} }`)
      const render = new Function('Vue', `${factory}; return createRender(Vue)`)(Vue)
      let received: Record<string, unknown> | undefined
      const app = Vue.createSSRApp({
        setup: () => ({ activeTab: 'ai-chat', currentSessionId: 'fixture', session: { name: 'Fixture' }, timeFilter }),
        render,
      })
      app.component(
        'ChatExplorer',
        Vue.defineComponent({
          props: ['sessionId', 'sessionName', 'chatType', 'timeFilter'],
          setup(props) {
            received = { ...props }
            return () => Vue.h('div')
          },
        })
      )
      await renderToString(app)
      assert.equal(received?.sessionId, 'fixture')
      assert.equal(received?.chatType, chatType)
      return received?.timeFilter
    }

    it('passes the selected historical range to AI chat', async () => {
      const range = { startTs: 1704038400, endTs: 1704124799 }
      assert.deepEqual(await renderChat(range), range)
    })

    it('preserves an absent range for the tools days fallback', async () => {
      assert.equal(await renderChat(), undefined)
    })

    it('uses the new range when returning to AI chat after changing the selection', async () => {
      await renderChat({ startTs: 1704038400, endTs: 1704124799 })
      const range = { startTs: 1704124800, endTs: 1704211199 }
      assert.deepEqual(await renderChat(range), range)
    })
  })
}
