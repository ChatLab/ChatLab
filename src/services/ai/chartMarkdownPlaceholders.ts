const CHART_IMAGE_PLACEHOLDER_RE =
  /^\s*!\[[^\]\n]*\]\(\s*(?:\.\/)?chart[\w-]*\.(?:png|jpg|jpeg|webp|svg)(?:\?[^)\s]*)?\s*(?:"[^"]*")?\s*\)\s*$/gim

export function stripChartImagePlaceholders(text: string): string {
  if (!text) return text
  return text
    .replace(CHART_IMAGE_PLACEHOLDER_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
}
