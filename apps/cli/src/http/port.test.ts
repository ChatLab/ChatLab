import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { prepareUnixSocket } from './port'

test('prepareUnixSocket leaves a live listener intact', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chatlab-socket-'))
  const socketPath = path.join(dir, 'live.sock')
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))

  try {
    await assert.rejects(() => prepareUnixSocket(socketPath), /already in use/)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    await rm(dir, { recursive: true, force: true })
  }
})

test('prepareUnixSocket never removes a non-socket entry', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chatlab-socket-'))
  const socketPath = path.join(dir, 'chatlab.sock')
  await writeFile(socketPath, 'keep me')

  try {
    await assert.rejects(() => prepareUnixSocket(socketPath), /is not a socket/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
