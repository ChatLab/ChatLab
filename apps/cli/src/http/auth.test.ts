import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from './server'
import { setAuthToken } from './auth'

describe('CLI HTTP auth hook', () => {
  it('requires bearer token for the CLI self-update endpoint under /_web', async () => {
    setAuthToken('clb_test_token')
    const app = createServer()
    app.post('/_web/system/update', async () => ({ success: true }))

    const response = await app.inject({ method: 'POST', url: '/_web/system/update' })
    await app.close()

    assert.equal(response.statusCode, 401)
  })
})
