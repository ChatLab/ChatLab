import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { LOCAL_EMBEDDING_RUNTIME_DIR_ENV, resolveCliLocalEmbeddingRuntimeConfig } from './local-runtime'

test('uses a platform-specific managed runtime below the CLI AI directory by default', () => {
  assert.deepEqual(resolveCliLocalEmbeddingRuntimeConfig('/tmp/chatlab-ai', {}), {
    baseDir: path.join('/tmp/chatlab-ai', 'runtime', 'local-embedding'),
    installMode: 'auto',
  })
})

test('treats an explicit runtime directory as preinstalled', () => {
  assert.deepEqual(
    resolveCliLocalEmbeddingRuntimeConfig('/tmp/chatlab-ai', {
      [LOCAL_EMBEDDING_RUNTIME_DIR_ENV]: '/opt/chatlab/local-embedding',
    }),
    {
      baseDir: '/opt/chatlab/local-embedding',
      installMode: 'preinstalled',
    }
  )
})
