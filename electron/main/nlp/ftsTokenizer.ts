/**
 * FTS5 专用分词器
 *
 * 与 NLP 词频分析不同，FTS 分词不做词性过滤和停用词过滤，
 * 搜索场景需要保留所有词以保证召回率。
 *
 * 使用 jieba 处理中文（天然兼容中英混合文本），
 * Intl.Segmenter 处理纯英文/日文。
 */

interface JiebaInstance {
  cut: (text: string, hmm?: boolean) => string[]
}

let jiebaInstance: JiebaInstance | null = null

function getJieba(): JiebaInstance {
  if (!jiebaInstance) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Jieba } = require('@node-rs/jieba')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { dict } = require('@node-rs/jieba/dict')
      jiebaInstance = Jieba.withDict(dict)
    } catch (error) {
      console.error('[FTS] Failed to load jieba module:', error)
      throw new Error('jieba 模块加载失败')
    }
  }
  return jiebaInstance!
}

/**
 * 对文本进行 FTS 分词，返回空格分隔的 token 字符串。
 * 用于写入 FTS5 索引。
 */
export function tokenizeForFts(text: string | null | undefined): string {
  if (!text || text.trim().length === 0) return ''

  try {
    const jieba = getJieba()
    const tokens = jieba.cut(text, false)
    return tokens
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0)
      .join(' ')
  } catch {
    return fallbackTokenize(text)
  }
}

/**
 * 降级分词：jieba 不可用时按字符/空格切分
 */
function fallbackTokenize(text: string): string {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .join(' ')
}

/**
 * 转义单个 token 使其在 FTS5 MATCH 中安全使用。
 * 用双引号包裹并转义内部双引号。
 */
function escapeToken(token: string): string {
  return `"${token.replace(/"/g, '""')}"`
}

/**
 * 将用户搜索关键词列表转换为 FTS5 MATCH 表达式。
 *
 * 语义：
 * - 单个关键词先分词，分词结果之间为 AND（都要出现）
 * - 多个关键词之间为 OR（任一匹配即可）
 *
 * 示例：
 * - ["今天开心"]          -> '"今天" "开心"'             (AND)
 * - ["今天开心", "难过"]  -> '("今天" "开心") OR "难过"' (OR)
 * - ["hello"]             -> '"hello"'
 */
export function tokenizeQueryForFts(keywords: string[]): string {
  if (keywords.length === 0) return ''

  const groups = keywords
    .map((kw) => {
      const trimmed = kw.trim()
      if (!trimmed) return ''

      try {
        const jieba = getJieba()
        const tokens = jieba
          .cut(trimmed, false)
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 0)

        if (tokens.length === 0) return ''
        if (tokens.length === 1) return escapeToken(tokens[0])
        return tokens.map(escapeToken).join(' ')
      } catch {
        const simple = trimmed.toLowerCase().trim()
        return simple ? escapeToken(simple) : ''
      }
    })
    .filter((g) => g.length > 0)

  if (groups.length === 0) return ''
  if (groups.length === 1) return groups[0]

  return groups.map((g) => (g.includes(' ') ? `(${g})` : g)).join(' OR ')
}
