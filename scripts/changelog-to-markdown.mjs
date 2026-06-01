/**
 * changelog-to-markdown.mjs
 *
 * 将 changelogs/{cn,en,tw,ja}.json 全量渲染为同名 .md 文件。
 * 幂等：每次全量重写，md 始终与 json 保持一致。
 *
 * 用法：
 *   node scripts/changelog-to-markdown.mjs
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// ── 本地化配置 ──────────────────────────────────────────────────────────────

const LOCALES = [
  { key: 'cn', h1: '更新日志' },
  { key: 'en', h1: 'Changelog' },
  { key: 'tw', h1: '更新日誌' },
  { key: 'ja', h1: '変更履歴' },
]

/** type → 各语言的标题（含 emoji）。缺失 type 回退为原始字符串，兼容未来扩展。 */
const TYPE_LABELS = {
  feat:     { cn: '✨ 新功能',         en: '✨ Features',        tw: '✨ 新功能',         ja: '✨ 新機能' },
  fix:      { cn: '🐛 修复',           en: '🐛 Bug Fixes',       tw: '🐛 修復',           ja: '🐛 バグ修正' },
  refactor: { cn: '♻️ 重构',           en: '♻️ Refactoring',     tw: '♻️ 重構',           ja: '♻️ リファクタリング' },
  perf:     { cn: '⚡ 性能',           en: '⚡ Performance',      tw: '⚡ 效能',           ja: '⚡ パフォーマンス' },
  docs:     { cn: '📝 文档',           en: '📝 Documentation',   tw: '📝 文件',           ja: '📝 ドキュメント' },
  style:    { cn: '💄 样式',           en: '💄 Styles',          tw: '💄 樣式',           ja: '💄 スタイル' },
  ci:       { cn: '👷 CI',             en: '👷 CI',               tw: '👷 CI',             ja: '👷 CI' },
  chore:    { cn: '🔧 杂项',           en: '🔧 Chores',          tw: '🔧 雜項',           ja: '🔧 雑務' },
}

// ── 渲染函数 ────────────────────────────────────────────────────────────────

/**
 * 将单个语言的 changelog 数组渲染为 Markdown 字符串。
 * @param {string} h1 - H1 标题文字
 * @param {string} langKey - 'cn' | 'en' | 'tw' | 'ja'（用于 type 标题查表）
 * @param {Array} entries - changelog 数组
 */
function renderMarkdown(h1, langKey, entries) {
  const lines = [`# ${h1}`, '']

  for (const entry of entries) {
    const { version, date, summary, changes } = entry

    lines.push(`## v${version} (${date})`)
    lines.push('')

    if (summary) {
      lines.push(`> ${summary}`)
      lines.push('')
    }

    if (Array.isArray(changes)) {
      for (const group of changes) {
        const { type, items } = group
        const typeMap = TYPE_LABELS[type]
        const label = typeMap ? typeMap[langKey] : type
        lines.push(`### ${label}`)
        lines.push('')
        for (const item of items) {
          lines.push(`- ${item}`)
        }
        lines.push('')
      }
    }
  }

  // 确保文件以单个换行结尾
  return lines.join('\n').trimEnd() + '\n'
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

let hasError = false

for (const { key, h1 } of LOCALES) {
  const jsonPath = resolve(ROOT, 'changelogs', `${key}.json`)
  const mdPath   = resolve(ROOT, 'changelogs', `${key}.md`)

  let entries
  try {
    entries = JSON.parse(readFileSync(jsonPath, 'utf8'))
  } catch (err) {
    console.error(`✗ 读取 ${jsonPath} 失败：${err.message}`)
    hasError = true
    continue
  }

  const md = renderMarkdown(h1, key, entries)
  writeFileSync(mdPath, md, 'utf8')
  console.log(`✓ changelogs/${key}.md  (${entries.length} 版本)`)
}

if (hasError) process.exit(1)
