import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VALIDATOR_PATH = path.join(ROOT_DIR, 'skills/chatlab-convert/scripts/validate-chatlab.mjs')

let tempDir = ''

function createDocument(sender: string, type: number): string {
  return JSON.stringify({
    chatlab: { version: '0.0.2', exportedAt: 1_711_468_800 },
    meta: { name: 'Group chat', platform: 'custom', type: 'group' },
    members: [{ platformId: 'alice', accountName: 'Alice' }],
    messages: [
      {
        sender,
        accountName: sender === 'SYSTEM' ? 'System' : 'Alice',
        timestamp: 1_711_468_800,
        type,
        content: 'Test message',
      },
    ],
  })
}

function runValidator(documentPath: string) {
  const result = spawnSync(process.execPath, [VALIDATOR_PATH, documentPath], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  })
  assert.equal(result.error, undefined)
  return {
    status: result.status,
    output: JSON.parse(result.stdout.trim()) as {
      ok: boolean
      data?: { issues: Array<{ code: string }> }
    },
  }
}

before(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-skill-validator-test-'))
})

after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('standalone ChatLab skill validator', () => {
  it('accepts reserved SYSTEM messages', () => {
    const documentPath = path.join(tempDir, 'system.json')
    fs.writeFileSync(documentPath, createDocument('SYSTEM', 80), 'utf8')

    const result = runValidator(documentPath)

    assert.equal(result.status, 0)
    assert.equal(result.output.ok, true)
  })

  it('rejects SYSTEM as a regular message sender', () => {
    const documentPath = path.join(tempDir, 'invalid-system.json')
    fs.writeFileSync(documentPath, createDocument('SYSTEM', 0), 'utf8')

    const result = runValidator(documentPath)

    assert.equal(result.status, 1)
    assert.equal(result.output.ok, false)
    assert.ok(result.output.data?.issues.some((issue) => issue.code === 'INVALID_SYSTEM_SENDER_TYPE'))
  })
})
