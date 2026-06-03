import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { performCliSelfUpdate } from './update-checker'

describe('performCliSelfUpdate', () => {
  it('installs the latest chatlab-cli package globally', async () => {
    const calls: Array<{ command: string; args: string[] }> = []

    const result = await performCliSelfUpdate({
      runCommand: async (command, args) => {
        calls.push({ command, args })
        return { success: true }
      },
      write: () => {},
      platform: 'darwin',
    })

    assert.deepEqual(calls, [
      {
        command: 'npm',
        args: ['install', '-g', 'chatlab-cli@latest'],
      },
    ])
    assert.deepEqual(result, { success: true })
  })
})
