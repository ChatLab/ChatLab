import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { describe, it } from 'node:test'
import type { DemoImportProgress } from './demo-import'
import { importDemoSessions } from './demo-import'

function sourceTimestamp(date: string, time: string): number {
  return Math.floor(new Date(`${date}T${time}+08:00`).getTime() / 1000)
}

function createDemoDocument(name: string, timestamps: number[]): string {
  return JSON.stringify({
    chatlab: {
      version: '0.0.2',
      exportedAt: sourceTimestamp('2000-01-01', '00:00:00'),
      generator: 'ChatLab Demo',
      description: 'x'.repeat(128),
      demoTimeline: {
        version: 1,
        mode: 'relative',
        referenceYear: 2000,
        timeZoneOffsetMinutes: 480,
      },
    },
    meta: { name, platform: 'qq', type: 'private' },
    members: [],
    messages: timestamps.map((timestamp, index) => ({
      sender: '1',
      accountName: 'Demo',
      timestamp,
      type: 0,
      platformMessageId: `${name}-${index}`,
      content: 'demo',
    })),
  })
}

describe('importDemoSessions', () => {
  it('rebases all downloaded sessions before importing them sequentially', async () => {
    const sourceLatest = sourceTimestamp('2000-12-10', '22:30:00')
    const documents = [
      createDemoDocument('group', [sourceTimestamp('2000-02-01', '09:00:00'), sourceLatest]),
      createDemoDocument('private-wukong', [sourceTimestamp('2000-06-01', '10:00:00')]),
    ]
    let downloadIndex = 0
    const requestedUrls: string[] = []
    const imported: Array<{ name: string; document: any }> = []
    const progress: DemoImportProgress[] = []
    const now = new Date('2026-07-25T04:00:00.000Z')

    const result = await importDemoSessions({
      locale: 'cn',
      tempPrefix: 'demo-service-test-',
      targetTimeZone: 'America/Los_Angeles',
      fetchImpl: async function (this: unknown, input) {
        assert.equal(this, globalThis)
        requestedUrls.push(String(input))
        return new Response(documents[downloadIndex++], { status: 200 })
      },
      now: () => now,
      onProgress: (event) => progress.push(event),
      importFile: async (filePath) => {
        const document = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        imported.push({ name: filePath, document })
        return { success: true, sessionId: `session-${imported.length}` }
      },
      deleteSession: async () => {},
    })

    const latestTimestamp = Math.floor(new Date('2026-07-24T05:30:00.000Z').getTime() / 1000)
    const offset = latestTimestamp - sourceLatest

    assert.deepEqual(result, {
      success: true,
      groupSessionId: 'session-1',
      privateSessionIds: ['session-2'],
    })
    assert.deepEqual(requestedUrls, [
      'https://chatlab.fun/assets/demo/cn/demo-group.json',
      'https://chatlab.fun/assets/demo/cn/demo-private-B-wukong.json',
    ])
    assert.equal(imported.length, 2)
    assert.equal(imported[0].document.messages[1].timestamp, latestTimestamp)
    assert.equal(imported[1].document.messages[0].timestamp, sourceTimestamp('2000-06-01', '10:00:00') + offset)
    assert.ok(imported.every(({ document }) => document.chatlab.exportedAt === Math.floor(now.getTime() / 1000)))
    assert.deepEqual(
      progress.map(({ stage, current }) => `${stage}:${current}`),
      ['downloading:1', 'downloading:2', 'importing:1', 'importing:2', 'done:2']
    )
    assert.ok(imported.every(({ name }) => !fs.existsSync(name)))
  })

  it('does not import any session when a downloaded document is invalid', async () => {
    let importCount = 0
    let downloadIndex = 0
    const progress: DemoImportProgress[] = []
    const responses = [createDemoDocument('group', [sourceTimestamp('2000-12-10', '22:30:00')]), 'x'.repeat(128)]

    const result = await importDemoSessions({
      locale: 'en',
      tempPrefix: 'demo-service-invalid-test-',
      fetchImpl: async () => new Response(responses[downloadIndex++], { status: 200 }),
      onProgress: (event) => progress.push(event),
      importFile: async () => {
        importCount += 1
        return { success: true, sessionId: 'unexpected' }
      },
      deleteSession: async () => {},
    })

    assert.equal(result.success, false)
    assert.match(result.error ?? '', /not valid JSON/)
    assert.equal(importCount, 0)
    assert.equal(progress.at(-1)?.stage, 'error')
  })

  it('rolls back sessions imported before a later session fails', async () => {
    let downloadIndex = 0
    let importCount = 0
    const rolledBackSessionIds: string[] = []
    const documents = [
      createDemoDocument('group', [sourceTimestamp('2000-12-10', '22:30:00')]),
      createDemoDocument('private-wukong', [sourceTimestamp('2000-12-08', '21:00:00')]),
    ]

    const result = await importDemoSessions({
      locale: 'cn',
      tempPrefix: 'demo-service-rollback-test-',
      fetchImpl: async () => new Response(documents[downloadIndex++], { status: 200 }),
      importFile: async () => {
        importCount += 1
        if (importCount === 2) return { success: false, error: 'second import failed' }
        return { success: true, sessionId: `session-${importCount}` }
      },
      deleteSession: async (sessionId) => {
        rolledBackSessionIds.push(sessionId)
      },
    })

    assert.equal(result.success, false)
    assert.match(result.error ?? '', /second import failed/)
    assert.deepEqual(rolledBackSessionIds, ['session-1'])
  })
})
