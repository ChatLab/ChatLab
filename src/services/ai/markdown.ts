import MarkdownIt from 'markdown-it'

export function createAiMarkdownRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    breaks: true,
    linkify: true,
    typographer: true,
  })

  // Treat model-generated images as text so reading a reply never loads an image URL.
  md.renderer.rules.image = (tokens, index, options, env, renderer) =>
    md.utils.escapeHtml(renderer.renderInlineAsText(tokens[index].children ?? [], options, env))

  return md
}
