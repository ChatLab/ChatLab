#!/usr/bin/env node
/**
 * ============================================================================
 * 前端 vue-i18n 废弃 key 扫描 / 清理工具
 * ----------------------------------------------------------------------------
 * 作用：扫描 src/i18n/locales 下的语言包，找出「在整个仓库源码中没有任何引用」
 *       的 i18n key，分级后可自动删除高置信度的遗留 key，并把需人工确认的写入
 *       一份本地复查清单。语言包随功能迭代很容易残留废弃 key，本脚本可定期复用。
 *
 * ── 命名空间规则 ────────────────────────────────────────────────────────────
 *   src/i18n/locales/<locale>/<name>.json 的内容会挂在顶层 key `<name>` 下
 *   （见 src/i18n/locales/<locale>/index.ts），所以一个叶子 key 的完整路径是
 *   `<name>.<json 内路径>`，例如 ai.json 里的 chat.message.title → ai.chat.message.title。
 *   命名空间集合由 canonical locale 目录下的 *.json 文件名动态推导，无需手工维护。
 *
 * ── 引用判定（保守：宁可漏报“废弃”，也不误删在用 key）────────────────────────
 *   扫描 src / apps / packages 下的 .ts/.tsx/.vue/.js/.mjs/.cjs，以「引号/反引号 +
 *   命名空间 + 至少一段 .path」为锚点抓取 key 引用（这样能正确穿透 Vue 模板里
 *   :attr="t('k')" 的嵌套引号）。一个 key 视为「已用」当且仅当满足任一：
 *     1. 精确：源码出现完整 key 字面量，如 t('ai.chat.title')。
 *     2. 动态前缀：模板串 t(`ai.x.${v}`) 截断出的前缀 `ai.x.`，覆盖其下所有子 key。
 *     3. 拼接前缀：'ai.x.' + v 形成的前缀，同样覆盖子 key。
 *     4. 子树：父路径被当字面量引用（如 tm('ai.x')），则 ai.x.* 全部视为已用。
 *   局限：完全由两个变量拼出、静态前缀从不出现的 key 无法识别 → 会进入 review 兜底。
 *
 * ── 置信度分级 ──────────────────────────────────────────────────────────────
 *   - high  ：同级（同一父路径）至少有一个 key 被静态使用 → 该分组在用、仅此一个
 *             未被引用，几乎可断定是遗留，--apply 会自动删除。
 *   - review：整个父分组都无任何引用 → 可能整块功能被移除（多半可删），也可能是
 *             完全动态拼接访问（有风险），交人工逐个确认。
 *   含纯数字路径段（数组元素，如 quotes 列表项）一律归入 review，不自动删除。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────────
 *   node scripts/find-unused-i18n.mjs
 *       文本报告，分别列出 high / review 两组（只读，不改文件）。
 *   node scripts/find-unused-i18n.mjs --json
 *       机器可读 JSON：{ totalKeys, highCount, reviewCount, high{}, review{} }。
 *   node scripts/find-unused-i18n.mjs --locale en-US
 *       指定 canonical locale（默认 zh-CN）；key 集合与原文展示以该语言为准。
 *   node scripts/find-unused-i18n.mjs --apply
 *       从「所有」locale 删除 high-confidence key（缺失的自动跳过），并把 review
 *       清单写入 .docs/tasks/i18n-unused-review.md（带 zh-CN 原文与勾选框）。
 *
 * ── 推荐复用流程 ────────────────────────────────────────────────────────────
 *   1. 先 `node scripts/find-unused-i18n.mjs` 看分级数量与样本，抽查几个 high 是否确为遗留；
 *   2. 确认无误后 `--apply` 删除 high 并生成 review 清单；
 *   3. 对改动的语言包跑 prettier 格式化（src/i18n/locales 下的所有 json）；
 *   4. 跑 `pnpm run type-check:web` 确认无破坏，再提交；
 *   5. 打开 .docs/tasks/i18n-unused-review.md 逐个确认 review key 后手动删除。
 * ============================================================================
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const apply = args.includes('--apply')
const localeArgIdx = args.indexOf('--locale')
const CANONICAL_LOCALE = localeArgIdx >= 0 ? args[localeArgIdx + 1] : 'zh-CN'

const LOCALES_DIR = path.join(ROOT, 'src', 'i18n', 'locales')
const REVIEW_DOC = path.join(ROOT, '.docs', 'tasks', 'i18n-unused-review.md')

/** 扫描这些目录里的源码作为“使用方” */
const SOURCE_DIRS = ['src', 'apps', 'packages']
const SOURCE_EXT = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs', '.cjs'])
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', 'out', '.git', 'coverage', '.vite', 'release'])

/** 把嵌套对象拍平成叶子 key 列表（点号路径） */
function flattenLeafKeys(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flattenLeafKeys(v, full, out)
    } else {
      // 数组（如 quotes 列表）与字符串都视为叶子
      out.push(full)
    }
  }
}

/** 读取 canonical locale 下所有 namespace 的叶子 key，返回 { keys, namespaces } */
function collectAllKeys() {
  const dir = path.join(LOCALES_DIR, CANONICAL_LOCALE)
  if (!fs.existsSync(dir)) {
    throw new Error(`Locale dir not found: ${dir}`)
  }
  const keys = []
  const namespaces = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const namespace = path.basename(file, '.json')
    namespaces.push(namespace)
    const json = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    const leaves = []
    flattenLeafKeys(json, '', leaves)
    for (const leaf of leaves) keys.push({ fullKey: `${namespace}.${leaf}`, namespace })
  }
  return { keys, namespaces }
}

/** 递归收集源码文件 */
function collectSourceFiles() {
  const files = []
  const walk = (abs) => {
    let entries
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIR.has(e.name)) continue
        walk(path.join(abs, e.name))
      } else if (SOURCE_EXT.has(path.extname(e.name))) {
        files.push(path.join(abs, e.name))
      }
    }
  }
  for (const d of SOURCE_DIRS) walk(path.join(ROOT, d))
  return files
}

/**
 * 从源码集合里构建引用集合。
 *
 * 关键点：Vue 模板里 `:title="t('a.b.c')"` 外层双引号会吞掉内层单引号，
 * 因此不能按引号配对解析字符串，而是「以命名空间锚定」直接抓 key：
 * 匹配 引号/反引号 + 命名空间 + 至少一段 .path。要求至少一段路径，避免
 * 裸串 'ai'（如 mode: 'ai'）把整个 ai.* 命名空间误判为已用。
 *
 * 对每个命中的 base（ns + 静态路径）：
 * - exact 记 base（精确引用 / 动态拼接前 base）。
 * - dotPrefixes 记 base + '.'，覆盖：
 *   - tm(base) 取子树；
 *   - `base.${var}` 模板动态（路径在 ${ 前被截断到 base）；
 *   - 'base.' + var 拼接。
 */
function buildReferenceIndex(files, namespaces) {
  const exact = new Set()
  const dotPrefixes = new Set()
  const nsAlt = namespaces.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const keyRe = new RegExp('[\'"`](' + nsAlt + ')((?:\\.[A-Za-z0-9_]+)+)', 'g')

  for (const file of files) {
    if (file.includes(path.join('i18n', 'locales'))) continue
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    let m
    keyRe.lastIndex = 0
    while ((m = keyRe.exec(text)) !== null) {
      const base = m[1] + m[2]
      exact.add(base)
      dotPrefixes.add(base + '.')
    }
  }
  return { exact, dotPrefixes: Array.from(dotPrefixes) }
}

function isUsed(key, ref) {
  if (ref.exact.has(key)) return true
  for (const p of ref.dotPrefixes) {
    if (key.startsWith(p)) return true
  }
  return false
}

const parentOf = (fullKey) => fullKey.slice(0, fullKey.lastIndexOf('.'))
const hasNumericSegment = (fullKey) => fullKey.split('.').some((s) => /^\d+$/.test(s))

/** 取 json 内某点号路径的值（用于复查文档展示原文） */
function valueAtPath(json, relPath) {
  let cur = json
  for (const seg of relPath.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[seg]
  }
  return cur
}

/** 删除 json 内某叶子路径，并向上修剪变空的对象；遇到数组则放弃（返回 false） */
function deleteLeaf(root, segments) {
  const stack = []
  let cur = root
  for (let i = 0; i < segments.length - 1; i++) {
    const s = segments[i]
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur) || !(s in cur)) return false
    stack.push([cur, s])
    cur = cur[s]
  }
  const last = segments[segments.length - 1]
  if (cur == null || typeof cur !== 'object' || Array.isArray(cur) || !(last in cur)) return false
  delete cur[last]
  for (let i = stack.length - 1; i >= 0; i--) {
    const [parent, key] = stack[i]
    const v = parent[key]
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) delete parent[key]
    else break
  }
  return true
}

/** 在所有 locale 里删除给定的 high-confidence full key 列表 */
function applyDeletions(highKeys) {
  const locales = fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

  const removedPerLocale = {}
  for (const locale of locales) {
    const dir = path.join(LOCALES_DIR, locale)
    const touched = new Map() // namespace -> json
    let removed = 0
    for (const fullKey of highKeys) {
      const namespace = fullKey.slice(0, fullKey.indexOf('.'))
      const relPath = fullKey.slice(namespace.length + 1)
      const file = path.join(dir, `${namespace}.json`)
      if (!fs.existsSync(file)) continue
      let json = touched.get(namespace)
      if (!json) {
        json = JSON.parse(fs.readFileSync(file, 'utf8'))
        touched.set(namespace, json)
      }
      if (deleteLeaf(json, relPath.split('.'))) removed++
    }
    for (const [namespace, json] of touched) {
      fs.writeFileSync(path.join(dir, `${namespace}.json`), JSON.stringify(json, null, 2) + '\n')
    }
    removedPerLocale[locale] = removed
  }
  return removedPerLocale
}

/** 生成复查文档（review 级别清单 + 当前 zh-CN 原文） */
function writeReviewDoc(reviewKeys, canonicalJsonByNs, stats) {
  const byNs = {}
  for (const k of reviewKeys) {
    const ns = k.slice(0, k.indexOf('.'))
    ;(byNs[ns] ||= []).push(k)
  }
  const lines = []
  lines.push('# i18n 待复查未使用 key')
  lines.push('')
  lines.push(`> 由 \`scripts/find-unused-i18n.mjs --apply\` 生成（canonical: ${CANONICAL_LOCALE}）。`)
  lines.push('>')
  lines.push(
    '> 这些 key 在源码中**完全没有静态/动态前缀引用**，且**整个父分组都无引用**——可能是整块功能被移除（多半可删），也可能被完全动态拼接访问（有风险）。请逐个确认后删除。'
  )
  lines.push('>')
  lines.push(`> 高置信度（同级有在用 key）的 ${stats.highCount} 个已自动从各 locale 删除，不在此列表。`)
  lines.push('')
  lines.push(`合计待复查：**${reviewKeys.length}** 个。`)
  lines.push('')
  for (const ns of Object.keys(byNs).sort()) {
    const list = byNs[ns].sort()
    lines.push(`## ${ns} (${list.length})`)
    lines.push('')
    lines.push('| key | zh-CN 原文 | 已确认可删 |')
    lines.push('| --- | --- | --- |')
    for (const fullKey of list) {
      const relPath = fullKey.slice(ns.length + 1)
      const val = valueAtPath(canonicalJsonByNs[ns], relPath)
      const text =
        typeof val === 'string'
          ? val.replace(/\|/g, '\\|').replace(/\n/g, ' ')
          : Array.isArray(val)
            ? `[数组 ${val.length} 项]`
            : ''
      lines.push(`| \`${fullKey}\` | ${text} | [ ] |`)
    }
    lines.push('')
  }
  fs.mkdirSync(path.dirname(REVIEW_DOC), { recursive: true })
  fs.writeFileSync(REVIEW_DOC, lines.join('\n'))
}

function classify(keys, ref) {
  // 统计每个父路径下是否存在「在用」的 key
  const parentHasUsed = new Map()
  for (const { fullKey } of keys) {
    const p = parentOf(fullKey)
    if (!parentHasUsed.has(p)) parentHasUsed.set(p, false)
    if (isUsed(fullKey, ref)) parentHasUsed.set(p, true)
  }
  const high = []
  const review = []
  for (const { fullKey } of keys) {
    if (isUsed(fullKey, ref)) continue
    if (!hasNumericSegment(fullKey) && parentHasUsed.get(parentOf(fullKey))) high.push(fullKey)
    else review.push(fullKey)
  }
  return { high, review }
}

function groupByNs(list) {
  const byNs = {}
  for (const k of list) (byNs[k.slice(0, k.indexOf('.'))] ||= []).push(k)
  for (const ns of Object.keys(byNs)) byNs[ns].sort()
  return byNs
}

function main() {
  const { keys, namespaces } = collectAllKeys()
  const files = collectSourceFiles()
  const ref = buildReferenceIndex(files, namespaces)
  const { high, review } = classify(keys, ref)

  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        {
          canonicalLocale: CANONICAL_LOCALE,
          totalKeys: keys.length,
          highCount: high.length,
          reviewCount: review.length,
          high: groupByNs(high),
          review: groupByNs(review),
        },
        null,
        2
      ) + '\n'
    )
    return
  }

  if (apply) {
    const canonicalJsonByNs = {}
    for (const ns of namespaces) {
      canonicalJsonByNs[ns] = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, CANONICAL_LOCALE, `${ns}.json`), 'utf8')
      )
    }
    writeReviewDoc(review, canonicalJsonByNs, { highCount: high.length })
    const removed = applyDeletions(high)
    console.log(`已删除 high-confidence key：${high.length} 个 / locale`)
    for (const [locale, n] of Object.entries(removed)) console.log(`  ${locale}: 实删 ${n}`)
    console.log(`复查清单（${review.length} 个）已写入: ${path.relative(ROOT, REVIEW_DOC)}`)
    console.log('请对修改的语言包运行 prettier 后提交。')
    return
  }

  console.log(`i18n 未使用 key 扫描（canonical: ${CANONICAL_LOCALE}）`)
  console.log(
    `扫描源码文件: ${files.length}，叶子 key 总数: ${keys.length}，high-confidence: ${high.length}，待复查: ${review.length}\n`
  )
  const printGroup = (title, byNs) => {
    console.log(`==== ${title} ====`)
    for (const ns of Object.keys(byNs).sort()) {
      console.log(`【${ns}】(${byNs[ns].length})`)
      for (const k of byNs[ns]) console.log(`  ${k}`)
    }
    console.log('')
  }
  printGroup('high-confidence（同级有在用 key，建议删除）', groupByNs(high))
  printGroup('review（整组无引用，需人工确认）', groupByNs(review))
}

main()
