/**
 * 反向代理路由 — /_proxy/chatlab.fun/*
 *
 * 在 Web 生产模式（chatlab start）下，将 /_proxy/chatlab.fun/* 代理到
 * https://chatlab.fun，行为与 vite.cli-web.config.mts 中的 dev proxy 保持一致，
 * 以解决浏览器 CORS 限制。
 *
 * 目标 host 硬编码为 https://chatlab.fun，不允许外部指定，避免开放代理风险。
 */

import type { FastifyInstance } from 'fastify'

const PROXY_TARGET = 'https://chatlab.fun'

export function registerProxyRoutes(server: FastifyInstance): void {
  server.get<{ Params: { '*': string } }>('/_proxy/chatlab.fun/*', async (request, reply) => {
    const subPath = request.params['*'] ?? ''
    const queryString = new URLSearchParams(request.query as Record<string, string>).toString()
    const targetUrl = queryString ? `${PROXY_TARGET}/${subPath}?${queryString}` : `${PROXY_TARGET}/${subPath}`

    try {
      const upstream = await fetch(targetUrl, {
        headers: { Accept: request.headers.accept ?? '*/*' },
        signal: AbortSignal.timeout(10_000),
      })

      const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
      const body = Buffer.from(await upstream.arrayBuffer())

      reply.code(upstream.status).header('content-type', contentType).send(body)
    } catch (err) {
      reply.code(502).send({
        error: 'Proxy error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
