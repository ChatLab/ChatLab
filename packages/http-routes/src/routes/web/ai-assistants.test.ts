import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import Fastify, { type FastifyInstance } from 'fastify'
import type { AssistantManager } from '@openchatlab/node-runtime'
import type { AssistantUpgradeInfo } from '@openchatlab/shared-types'
import { registerAiAssistantRoutes } from './ai-assistants'

describe('AI assistant upgrade routes', () => {
  let app: FastifyInstance
  let statusAssistantId: string | null
  let upgradeRequest: { id: string; backupName: string } | null

  beforeEach(async () => {
    statusAssistantId = null
    upgradeRequest = null
    const upgradeInfo: AssistantUpgradeInfo = {
      assistantId: 'general_cn',
      builtinId: 'general_cn',
      name: '通用助手',
      currentVersion: null,
      latestVersion: 2,
    }
    const assistantManager = {
      getAssistantUpgradeInfo(id: string) {
        statusAssistantId = id
        return id === 'general_cn' ? upgradeInfo : null
      },
      upgradeAssistantWithBackup(id: string, backupName: string) {
        upgradeRequest = { id, backupName }
        if (backupName === 'fail') return { success: false, error: 'Upgrade failed' }
        return { success: true, backupId: 'custom_1' }
      },
    } as unknown as AssistantManager

    app = Fastify()
    registerAiAssistantRoutes(app, { assistantManager })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns upgrade information for the requested assistant', async () => {
    const response = await app.inject({ method: 'GET', url: '/_web/ai/assistants/general_cn/upgrade-status' })

    assert.equal(response.statusCode, 200)
    assert.equal(statusAssistantId, 'general_cn')
    assert.deepEqual(response.json(), {
      assistantId: 'general_cn',
      builtinId: 'general_cn',
      name: '通用助手',
      currentVersion: null,
      latestVersion: 2,
    })
  })

  it('forwards the localized backup name and maps failures to 400', async () => {
    const success = await app.inject({
      method: 'POST',
      url: '/_web/ai/assistants/general_cn/upgrade',
      payload: { backupName: '通用助手（旧版备份）' },
    })

    assert.equal(success.statusCode, 200)
    assert.deepEqual(upgradeRequest, { id: 'general_cn', backupName: '通用助手（旧版备份）' })
    assert.deepEqual(success.json(), { success: true, backupId: 'custom_1' })

    const failure = await app.inject({
      method: 'POST',
      url: '/_web/ai/assistants/general_cn/upgrade',
      payload: { backupName: 'fail' },
    })
    assert.equal(failure.statusCode, 400)
    assert.deepEqual(failure.json(), { success: false, error: 'Upgrade failed' })
  })

  it('rejects an upgrade request without a backup name', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/_web/ai/assistants/general_cn/upgrade',
      payload: {},
    })

    assert.equal(response.statusCode, 400)
    assert.deepEqual(response.json(), { success: false, error: 'backupName must be a string' })
    assert.equal(upgradeRequest, null)
  })
})
