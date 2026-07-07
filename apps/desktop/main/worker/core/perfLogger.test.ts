import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { getLogsDir, initDbDir } from './dbCore'
import { getImportLogDir } from './perfLogPath'

describe('desktop worker import perf logger', () => {
  afterEach(() => {
    initDbDir('', '', '', undefined, '')
  })

  it('resolves import logs under the injected system logs directory', () => {
    const root = path.join('/tmp', 'chatlab-worker-perf-log')
    const dbDir = path.join(root, 'data', 'databases')
    const cacheDir = path.join(root, 'cache')
    const tempDir = path.join(root, 'temp')
    const logsDir = path.join(root, 'logs')

    initDbDir(dbDir, cacheDir, tempDir, undefined, logsDir)

    assert.equal(getLogsDir(), logsDir)
    assert.equal(getImportLogDir(logsDir), path.join(logsDir, 'import'))
    assert.notEqual(getImportLogDir(logsDir), path.join(root, 'data', 'logs', 'import'))
  })
})
