import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CHATLAB_FORMAT_VERSION } from '@openchatlab/shared-types'
import { validateChatLabFile } from './chatlab-validator'

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-validator-'))
}

function writeJsonl(filePath: string, rows: unknown[]): void {
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')
}

test('validates a complete ChatLab JSONL file without exposing message content', async () => {
  const root = makeTempDir()
  const filePath = path.join(root, 'converted.jsonl')
  fs.writeFileSync(
    filePath,
    [
      '# generated locally',
      '',
      JSON.stringify({
        _type: 'header',
        chatlab: { version: CHATLAB_FORMAT_VERSION, exportedAt: 1_711_468_800 },
        meta: { name: 'Example', platform: 'custom', type: 'group', ownerId: 'alice' },
      }),
      JSON.stringify({ _type: 'member', platformId: 'alice', accountName: 'Alice' }),
      JSON.stringify({ _type: 'member', platformId: 'bob', accountName: 'Bob' }),
      JSON.stringify({
        _type: 'message',
        platformMessageId: 'message-1',
        sender: 'alice',
        accountName: 'Alice',
        timestamp: 1_711_468_800,
        type: 0,
        content: 'private sample text',
      }),
      JSON.stringify({
        _type: 'message',
        platformMessageId: 'message-2',
        replyToMessageId: 'message-1',
        sender: 'bob',
        accountName: 'Bob',
        timestamp: 1_711_468_810,
        type: 25,
        content: 'reply',
      }),
    ].join('\n'),
    'utf8'
  )

  try {
    const report = await validateChatLabFile(filePath)
    assert.equal(report.valid, true)
    assert.equal(report.errorCount, 0)
    assert.equal(report.warningCount, 0)
    assert.deepEqual(report.stats, {
      headerCount: 1,
      memberCount: 2,
      messageCount: 2,
      uniqueSenderCount: 2,
      commentLineCount: 1,
      blankLineCount: 1,
    })
    assert.equal(JSON.stringify(report).includes('private sample text'), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('accepts the initial ChatLab JSON format version', async () => {
  const root = makeTempDir()
  const filePath = path.join(root, 'legacy.json')
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      chatlab: { version: '0.0.1', exportedAt: 1_711_468_800 },
      meta: { name: 'Legacy chat', platform: 'custom', type: 'private' },
      members: [{ platformId: 'alice', accountName: 'Alice' }],
      messages: [
        {
          sender: 'alice',
          accountName: 'Alice',
          timestamp: 1_711_468_800,
          type: 0,
          content: 'Hello',
        },
      ],
    }),
    'utf8'
  )

  try {
    const report = await validateChatLabFile(filePath)
    assert.equal(report.valid, true)
    assert.equal(report.version, '0.0.1')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('reports malformed and lossy JSONL output as invalid', async () => {
  const root = makeTempDir()
  const filePath = path.join(root, 'broken.jsonl')
  fs.writeFileSync(
    filePath,
    [
      JSON.stringify({
        _type: 'header',
        chatlab: { version: '9.9.9', exportedAt: 1_711_468_800_000 },
        meta: { name: 'Broken', platform: 'custom', type: 'room', ownerId: 'missing-owner' },
      }),
      JSON.stringify({ _type: 'member', platformId: 'alice', accountName: 'Alice' }),
      '{bad json',
      JSON.stringify({
        _type: 'message',
        platformMessageId: 'same-id',
        sender: 'missing-member',
        accountName: 'Unknown',
        timestamp: 1_711_468_800_000,
        type: 6,
        content: 'text',
      }),
      JSON.stringify({
        _type: 'message',
        platformMessageId: 'same-id',
        replyToMessageId: 'not-found',
        sender: 'alice',
        accountName: 'Alice',
        timestamp: 1_711_468_700,
        type: 0,
        content: 'text',
      }),
      JSON.stringify({ _type: 'member', platformId: 'late', accountName: 'Late member' }),
    ].join('\n'),
    'utf8'
  )

  try {
    const report = await validateChatLabFile(filePath)
    const codes = new Set(report.issues.map((issue) => issue.code))
    assert.equal(report.valid, false)
    assert.ok(report.errorCount >= 7)
    assert.ok(codes.has('UNSUPPORTED_VERSION'))
    assert.ok(codes.has('INVALID_UNIX_SECONDS'))
    assert.ok(codes.has('INVALID_CHAT_TYPE'))
    assert.ok(codes.has('INVALID_JSONL_LINE'))
    assert.ok(codes.has('INVALID_MESSAGE_TYPE'))
    assert.ok(codes.has('DUPLICATE_MESSAGE_ID'))
    assert.ok(codes.has('UNKNOWN_MESSAGE_SENDER'))
    assert.ok(codes.has('UNKNOWN_OWNER'))
    assert.ok(codes.has('MEMBER_AFTER_MESSAGE'))
    assert.ok(codes.has('UNKNOWN_REPLY_TARGET'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('validates ChatLab JSON members and messages', async () => {
  const root = makeTempDir()
  const filePath = path.join(root, 'converted.json')
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      chatlab: { version: CHATLAB_FORMAT_VERSION, exportedAt: 1_711_468_800 },
      meta: { name: 'Direct chat', platform: 'custom', type: 'private' },
      members: [
        { platformId: 'me', accountName: 'Me' },
        { platformId: 'friend', accountName: 'Friend', aliases: ['F'] },
      ],
      messages: [
        {
          sender: 'me',
          accountName: 'Me',
          timestamp: 1_711_468_800,
          type: 0,
          content: 'Hello',
        },
      ],
    }),
    'utf8'
  )

  try {
    const report = await validateChatLabFile(filePath)
    assert.equal(report.valid, true)
    assert.equal(report.format, 'json')
    assert.equal(report.stats.memberCount, 2)
    assert.equal(report.stats.messageCount, 1)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('requires explicit members in ChatLab JSON', async () => {
  const root = makeTempDir()
  const filePath = path.join(root, 'missing-members.json')
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      chatlab: { version: CHATLAB_FORMAT_VERSION, exportedAt: 1_711_468_800 },
      meta: { name: 'Direct chat', platform: 'custom', type: 'private' },
      messages: [
        {
          sender: 'me',
          accountName: 'Me',
          timestamp: 1_711_468_800,
          type: 0,
          content: 'Hello',
        },
      ],
    }),
    'utf8'
  )

  try {
    const report = await validateChatLabFile(filePath)
    assert.equal(report.valid, false)
    assert.ok(report.issues.some((issue) => issue.code === 'MISSING_MEMBERS'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('rejects unsupported output extensions', async () => {
  const root = makeTempDir()
  const filePath = path.join(root, 'converted.txt')
  writeJsonl(filePath, [])

  try {
    const report = await validateChatLabFile(filePath)
    assert.equal(report.valid, false)
    assert.equal(report.errorCount, 1)
    assert.ok(report.issues.some((issue) => issue.code === 'UNSUPPORTED_EXTENSION'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
