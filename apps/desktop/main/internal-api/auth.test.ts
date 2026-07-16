import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { createInternalAuthHook } from './auth'

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
    headers: authorization ? { authorization } : {},
  } as unknown as FastifyRequest
}

describe('internal API authentication', () => {
  it('rejects missing and invalid bearer tokens', async () => {
    const hook = createInternalAuthHook('expected-token')

    const missing: ReplyResult = {}
    await hook(createRequest('GET'), createReply(missing))
    assert.equal(missing.statusCode, 401)
    assert.deepEqual(missing.payload, {
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' },
    })

    const invalid: ReplyResult = {}
    await hook(createRequest('GET', 'Bearer wrong-token'), createReply(invalid))
    assert.equal(invalid.statusCode, 401)
    assert.deepEqual(invalid.payload, {
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid token' },
    })
  })

  it('accepts the current token and lets preflight requests pass', async () => {
    const hook = createInternalAuthHook('expected-token')

    const authorized: ReplyResult = {}
    await hook(createRequest('GET', 'Bearer expected-token'), createReply(authorized))
    assert.equal(authorized.statusCode, undefined)

    const preflight: ReplyResult = {}
    await hook(createRequest('OPTIONS'), createReply(preflight))
    assert.equal(preflight.statusCode, undefined)
  })
})
