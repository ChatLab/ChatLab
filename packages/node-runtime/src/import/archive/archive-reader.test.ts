import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'

import { ArchiveImportError } from './errors'
import { ZipArchiveReader, validateArchiveEntryName } from './archive-reader'
import { writeZipFixture } from './test-utils'

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  return Buffer.concat(chunks).toString('utf8')
}

describe('ZipArchiveReader', () => {
  it('lists Unicode entries and streams selected content', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatlab-archive-reader-'))
    try {
      const zipPath = join(dir, 'sample.zip')
      writeZipFixture(zipPath, [
        { name: 'Takeout/Google Chat/Groups/DM sample/messages.json', content: '{"messages":[]}' },
        { name: 'Takeout/Google Chat/Groups/DM sample/File-测试.txt', content: 'ignored' },
      ])

      const reader = new ZipArchiveReader(zipPath)
      const entries = await reader.listEntries()
      assert.deepEqual(
        entries.map((entry) => entry.name),
        ['Takeout/Google Chat/Groups/DM sample/messages.json', 'Takeout/Google Chat/Groups/DM sample/File-测试.txt']
      )

      let messages = ''
      await reader.visitEntries(async (entry, openStream) => {
        if (entry.name.endsWith('/messages.json')) {
          messages = await streamToString(await openStream())
        }
      })
      assert.equal(messages, '{"messages":[]}')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('pipes selected entries to fixed destinations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatlab-archive-pipe-'))
    try {
      const zipPath = join(dir, 'sample.zip')
      const outputPath = join(dir, 'messages.json')
      writeZipFixture(zipPath, [{ name: 'source/messages.json', content: '{"messages":[1]}' }])

      const reader = new ZipArchiveReader(zipPath)
      await reader.pipeEntries(new Map([['source/messages.json', outputPath]]))
      assert.equal(readFileSync(outputPath, 'utf8'), '{"messages":[1]}')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects unsafe names, corrupt archives, encryption, and limits', async () => {
    for (const unsafe of ['/absolute', 'C:/drive', '../escape', 'safe/../escape', 'back\\slash']) {
      assert.throws(
        () => validateArchiveEntryName(unsafe),
        (error) => error instanceof ArchiveImportError && error.code === 'error.archive_unsafe_path'
      )
    }

    const dir = mkdtempSync(join(tmpdir(), 'chatlab-archive-invalid-'))
    try {
      const corruptPath = join(dir, 'corrupt.zip')
      writeFileSync(corruptPath, 'not a zip')
      await assert.rejects(
        () => new ZipArchiveReader(corruptPath).listEntries(),
        (error) => error instanceof ArchiveImportError && error.code === 'error.archive_corrupt'
      )

      const encryptedPath = join(dir, 'encrypted.zip')
      writeZipFixture(encryptedPath, [{ name: 'secret.json', content: '{}', encrypted: true }])
      await assert.rejects(
        () => new ZipArchiveReader(encryptedPath).listEntries(),
        (error) => error instanceof ArchiveImportError && error.code === 'error.archive_encrypted'
      )

      const manyPath = join(dir, 'many.zip')
      writeZipFixture(manyPath, [
        { name: 'a.json', content: '{}' },
        { name: 'b.json', content: '{}' },
      ])
      await assert.rejects(
        () => new ZipArchiveReader(manyPath, { maxEntries: 1 }).listEntries(),
        (error) => error instanceof ArchiveImportError && error.code === 'error.archive_limit_exceeded'
      )

      const ratioPath = join(dir, 'ratio.zip')
      writeZipFixture(ratioPath, [{ name: 'large.json', content: 'a'.repeat(10_000) }])
      await assert.rejects(
        () => new ZipArchiveReader(ratioPath, { maxCompressionRatio: 2 }).listEntries(),
        (error) => error instanceof ArchiveImportError && error.code === 'error.archive_limit_exceeded'
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
