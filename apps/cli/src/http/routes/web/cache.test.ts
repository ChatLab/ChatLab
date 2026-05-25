import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { openDirectoryPath, showPathInFolder } from './cache'

describe('CLI Web cache route helpers', () => {
  it('opens directories with execFile arguments instead of shell commands', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const dirPath = '/tmp/chat"lab; touch /tmp/pwned'

    await openDirectoryPath(dirPath, 'darwin', (file, args, callback) => {
      calls.push({ file, args })
      callback(null)
    })

    assert.deepEqual(calls, [{ file: 'open', args: [dirPath] }])
  })

  it('reveals files with execFile arguments instead of shell commands', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const filePath = '/tmp/chat"lab; touch /tmp/pwned/export.json'

    await showPathInFolder(filePath, 'darwin', (file, args, callback) => {
      calls.push({ file, args })
      callback(null)
    })

    assert.deepEqual(calls, [{ file: 'open', args: ['-R', filePath] }])
  })
})
