/**
 * Semantic Pipeline 实现
 *
 * RAG 流程：Query 改写 → 切片召回 → 向量相似度排序 → 生成证据块
 */

import type { SemanticPipelineOptions, SemanticPipelineResult, ChunkMetadata } from './types'
import type { Chunk } from '../types'
import { getEmbeddingService } from '../embedding'
import { getVectorStore } from '../store'
import { getSessionChunks } from '../chunking'
import { loadRAGConfig } from '../config'
import { completeSimple, type TextContent as PiTextContent } from '@mariozechner/pi-ai'
import { getActiveConfig, buildPiModel } from '../../llm'
import { aiLogger as logger } from '../../logger'

/**
 * Query 改写提示词
 */
const QUERY_REWRITE_PROMPT = `你是一个查询优化专家。请将用户的问题改写为更适合语义检索的查询。

要求：
1. 保留核心语义，去除口语化表达
2. 提取关键实体和概念
3. 扩展同义词或相关表达
4. 输出一个简洁的检索查询，不要解释

用户问题：{query}

改写后的查询：`

/**
 * 执行 Query 改写
 */
async function rewriteQuery(query: string, abortSignal?: AbortSignal): Promise<string> {
  try {
    const activeConfig = getActiveConfig()
    if (!activeConfig) return query

    const piModel = buildPiModel(activeConfig)
    const prompt = QUERY_REWRITE_PROMPT.replace('{query}', query)

    const result = await completeSimple(
      piModel,
      {
        systemPrompt: '你是一个查询优化专家，专门将用户问题改写为更适合语义检索的形式。',
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      },
      {
        apiKey: activeConfig.apiKey,
        temperature: 0.3,
        maxTokens: 200,
        signal: abortSignal,
      }
    )

    const rewritten = result.content
      .filter((item): item is PiTextContent => item.type === 'text')
      .map((item) => item.text)
      .join('')
      .trim()

    return rewritten || query
  } catch (error) {
    logger.warn('Semantic Pipeline', 'Query rewrite failed, using original query', error)
    return query
  }
}

/**
 * 余弦相似度计算
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  const len = Math.min(a.length, b.length)

  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-12)
}

/**
 * 格式化证据块（用于注入 System Prompt）
 */
function formatEvidenceBlock(
  rewrittenQuery: string,
  results: Array<{ score: number; chunkId: string; content: string; metadata?: ChunkMetadata }>
): string {
  if (results.length === 0) {
    return ''
  }

  const lines = [`<evidence query="${rewrittenQuery}">`, `以下是与用户问题语义相关的历史对话片段（按相关度排序）：`, '']

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const score = (result.score * 100).toFixed(1)
    lines.push(`--- 片段 ${i + 1} (相关度: ${score}%) ---`)
    lines.push(result.content)
    lines.push('')
  }

  lines.push('</evidence>')
  lines.push('')
  lines.push('请基于以上历史对话片段回答用户的问题。如果片段中没有相关信息，请说明。')

  return lines.join('\n')
}

/**
 * 执行 Semantic Pipeline
 */
export async function executeSemanticPipeline(options: SemanticPipelineOptions): Promise<SemanticPipelineResult> {
  const { userMessage, dbPath, timeFilter, abortSignal } = options

  // 获取 RAG 配置
  const ragConfig = loadRAGConfig()
  const candidateLimit = options.candidateLimit ?? ragConfig.candidateLimit ?? 50
  const topK = options.topK ?? ragConfig.topK ?? 10

  logger.info('RAG', `🔍 Starting semantic search: "${userMessage.slice(0, 50)}..."`)

  try {
    // 1. 检查 Embedding 服务
    const embeddingService = await getEmbeddingService()
    if (!embeddingService) {
      logger.warn('RAG', 'Semantic search skipped: Embedding service not enabled')
      return {
        success: false,
        results: [],
        error: 'Embedding 服务未启用或未配置',
      }
    }

    // 2. Query 改写
    const rewrittenQuery = await rewriteQuery(userMessage, abortSignal)

    // 检查中止
    if (abortSignal?.aborted) {
      return { success: false, results: [], error: '操作已取消' }
    }

    // 3. 获取会话级切片
    const chunks = getSessionChunks(dbPath, {
      limit: candidateLimit,
      timeFilter,
      filterInvalid: true,
    })

    if (chunks.length === 0) {
      logger.warn('RAG', 'Semantic search skipped: no session chunks available')
      return {
        success: true,
        rewrittenQuery,
        results: [],
        evidenceBlock: '',
      }
    }

    // 4. 获取或计算 Embedding
    const vectorStore = await getVectorStore()
    const chunkVectors = new Map<string, number[]>()
    const uncachedChunks: Chunk[] = []

    // 检查缓存
    for (const chunk of chunks) {
      if (vectorStore) {
        const cached = await vectorStore.get(chunk.id)
        if (cached) {
          chunkVectors.set(chunk.id, cached)
          continue
        }
      }
      uncachedChunks.push(chunk)
    }

    // 检查中止
    if (abortSignal?.aborted) {
      return { success: false, results: [], error: '操作已取消' }
    }

    // 批量计算未缓存的 Embedding
    if (uncachedChunks.length > 0) {
      const contents = uncachedChunks.map((c) => c.content)
      const vectors = await embeddingService.embedBatch(contents)

      // 存入缓存并记录
      for (let i = 0; i < uncachedChunks.length; i++) {
        const chunk = uncachedChunks[i]
        const vector = vectors[i]
        chunkVectors.set(chunk.id, vector)

        if (vectorStore) {
          // ChunkMetadata 是结构化对象，这里仅在向量存储层按通用元数据字典处理。
          await vectorStore.add(chunk.id, vector, chunk.metadata as unknown as Record<string, unknown>)
        }
      }
    }

    // 检查中止
    if (abortSignal?.aborted) {
      return { success: false, results: [], error: '操作已取消' }
    }

    // 5. 计算 Query Embedding
    const queryVector = await embeddingService.embed(rewrittenQuery)

    // 6. 向量相似度排序
    const scoredResults: Array<{
      score: number
      chunkId: string
      content: string
      metadata?: ChunkMetadata
    }> = []

    for (const chunk of chunks) {
      const vector = chunkVectors.get(chunk.id)
      if (!vector) continue

      const score = cosineSimilarity(queryVector, vector)
      scoredResults.push({
        score,
        chunkId: chunk.id,
        content: chunk.content,
        metadata: chunk.metadata,
      })
    }

    // 排序取 topK
    scoredResults.sort((a, b) => b.score - a.score)
    const topResults = scoredResults.slice(0, topK)

    const topScore = topResults[0]?.score ?? 0
    logger.info(
      'RAG',
      `✅ Semantic search done: returned ${topResults.length}  results, top relevance ${(topScore * 100).toFixed(1)}%`
    )

    // 7. 生成证据块
    const evidenceBlock = formatEvidenceBlock(rewrittenQuery, topResults)

    return {
      success: true,
      rewrittenQuery,
      results: topResults,
      evidenceBlock,
    }
  } catch (error) {
    logger.error('RAG', '❌ Semantic search failed', error)
    return {
      success: false,
      results: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
