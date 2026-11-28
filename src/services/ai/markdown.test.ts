import assert from 'node:assert/strict'
import test from 'node:test'
import { createAiMarkdownRenderer } from './markdown'

test('AI Markdown shows escaped alt text instead of inline or reference images', () => {
  const md = createAiMarkdownRenderer()
  const html = md.render(
    '![Preview <label>](https://example.test/preview.png)\n\n![Reference preview][preview]\n\n[preview]: https://example.test/preview.png'
  )

  assert.equal(html, '<p>Preview &lt;label&gt;</p>\n<p>Reference preview</p>\n')
})

test('AI Markdown preserves text formatting and ordinary links', () => {
  const md = createAiMarkdownRenderer()
  assert.equal(
    md.render('**Details:** [Open the documentation](https://example.test/docs)'),
    '<p><strong>Details:</strong> <a href="https://example.test/docs">Open the documentation</a></p>\n'
  )
})
