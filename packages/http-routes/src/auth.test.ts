import assert from 'node:assert/strict'
import test from 'node:test'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { createBearerAuthHook } from './auth'

interface ReplyResult {
  statusCode?: number
  payload?: unknown
}

function createReply(result: ReplyResult): FastifyReply {
  const reply = {
    code(statusCode: number) {
      result.statusCode = statusCode
      return reply
    },
    send(payload: unknown) {
      result.payload = payload
      return reply
    },
  }
  return reply as unknown as FastifyReply
}

function createRequest(method: string, authorization?: string): FastifyRequest {
  return {
    method,
    url: '/api/v1/status',
    headers: authorization ? { authorization } : {},
  } as unknown as FastifyRequest
}

test('createBearerAuthHook supports strict auth with distinct missing and invalid messages', async () => {
  const hook = createBearerAuthHook({
    getToken: () => 'expected-token',
    allowMissingToken: false,
    missingTokenMessage: 'Missing or invalid token',
    invalidTokenMessage: 'Invalid token',
  })

  const missing: ReplyResult = {}
  await hook(createRequest('GET'), createReply(missing))
  assert.deepEqual(missing, {
    statusCode: 401,
    payload: { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } },
  })

  const invalid: ReplyResult = {}
  await hook(createRequest('GET', 'Bearer wrong-token'), createReply(invalid))
  assert.deepEqual(invalid, {
    statusCode: 401,
    payload: { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
  })

  const authorized: ReplyResult = {}
  await hook(createRequest('GET', 'Bearer expected-token'), createReply(authorized))
  assert.deepEqual(authorized, {})
})

test('createBearerAuthHook can skip preflight requests and allow an intentionally missing token', async () => {
  const strictHook = createBearerAuthHook({
    getToken: () => 'expected-token',
    allowMissingToken: false,
    shouldAuthenticate: (request) => request.method !== 'OPTIONS',
  })
  const preflight: ReplyResult = {}
  await strictHook(createRequest('OPTIONS'), createReply(preflight))
  assert.deepEqual(preflight, {})

  const optionalHook = createBearerAuthHook({ getToken: () => null })
  const noToken: ReplyResult = {}
  await optionalHook(createRequest('GET'), createReply(noToken))
  assert.deepEqual(noToken, {})
})
