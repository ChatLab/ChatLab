import assert from 'node:assert/strict'
import test from 'node:test'
import { IMPORT_IN_PROGRESS_ERROR_KEY } from '@openchatlab/node-runtime/src/import/import-lock'
import { ApiErrorCode } from '../errors'
import { analysisFromNewImport, analysisFromPushImport, apiErrorFromImportResult } from './import-helpers'

test('maps an import lock result to the documented 409 API error', () => {
  const error = apiErrorFromImportResult(IMPORT_IN_PROGRESS_ERROR_KEY, 'Import failed')

  assert.equal(error.code, ApiErrorCode.IMPORT_IN_PROGRESS)
  assert.equal(error.statusCode, 409)
})

test('keeps ordinary import failures as IMPORT_FAILED', () => {
  const error = apiErrorFromImportResult('database write failed', 'Import failed')

  assert.equal(error.code, ApiErrorCode.IMPORT_FAILED)
  assert.equal(error.statusCode, 500)
  assert.equal(error.message, 'database write failed')
})

test('maps new-import analysis counts without assuming every parsed message is new', () => {
  assert.deepEqual(
    analysisFromNewImport({
      totalMessages: 12,
      newMessageCount: 7,
      duplicateCount: 3,
      totalMembers: 4,
      meta: { name: 'Fixture', platform: 'wechat', type: 'private' },
    }),
    {
      totalInFile: 12,
      newMessageCount: 7,
      duplicateCount: 3,
      newMemberCount: 4,
    }
  )
})

test('preserves the Desktop dry-run response shape for new and existing push imports', () => {
  const base = {
    sessionId: 'push-analysis',
    totalInFile: 3,
    newMessageCount: 2,
    duplicateCount: 1,
  }

  assert.deepEqual(analysisFromPushImport({ ...base, created: true, newMemberCount: 4 }), {
    totalInFile: 3,
    newMessageCount: 2,
    duplicateCount: 1,
    newMemberCount: 4,
  })
  assert.deepEqual(analysisFromPushImport({ ...base, created: false }), {
    totalInFile: 3,
    newMessageCount: 2,
    duplicateCount: 1,
  })
})
