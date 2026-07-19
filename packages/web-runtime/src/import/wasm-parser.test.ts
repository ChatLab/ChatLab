import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import initWasm, { initSync, WasmParser } from '../wasm/generated/parser_native.js'
import { WebRuntimeError } from '../runtime-error'
import { parseBrowserImportSource } from './browser-parser'
import type { BrowserParseSource } from './chatlab-parser'
import type { BrowserWasmParserLoader } from './wasm-parser'

const wasmBytes = new Uint8Array(readFileSync(new URL('../wasm/generated/parser_native_bg.wasm', import.meta.url)))
initSync({ module: wasmBytes })

const wasmLoader: BrowserWasmParserLoader = async () => ({ default: initWasm, WasmParser })

function source(name: string, value: unknown): BrowserParseSource {
  const blob = new Blob([typeof value === 'string' ? value : JSON.stringify(value)])
  return {
    name,
    size: blob.size,
    type: 'application/json',
    text: () => blob.text(),
    arrayBuffer: () => blob.arrayBuffer(),
    slice: (start, end) => blob.slice(start, end),
  }
}

describe('browser Rust WASM parser', () => {
  it('parses ChatLab JSON and WeFlow JSON through the generated WASM module', async () => {
    const chatlabSource = source('chatlab.json', {
      chatlab: { version: '1' },
      meta: { name: 'ChatLab', platform: 'wechat', type: 'group' },
      members: [{ platformId: 'alice', accountName: 'Alice' }],
      messages: [
        {
          sender: 'alice',
          accountName: 'Alice',
          timestamp: 1,
          type: 0,
          content: 'hello chatlab',
        },
      ],
    })
    const chatlab = await parseBrowserImportSource(chatlabSource, { formatId: 'chatlab', wasmLoader })
    const chatlabTs = await parseBrowserImportSource(chatlabSource, {
      formatId: 'chatlab',
      wasmLoader: async () => null,
    })
    assert.equal(chatlab.meta.name, 'ChatLab')
    assert.deepEqual(
      chatlab.members.map((member) => member.platformId),
      ['alice']
    )
    assert.deepEqual(
      chatlab.messages.map((message) => message.content),
      ['hello chatlab']
    )
    assert.deepEqual(chatlab, chatlabTs)

    const weflowSource = source('weflow.json', {
      weflow: { version: '1' },
      session: { wxid: 'room@chatroom', displayName: 'WeFlow', type: '群聊' },
      messages: [
        {
          localId: 1,
          createTime: 2,
          type: '文本消息',
          content: 'hello weflow',
          isSend: 1,
          senderUsername: 'bob',
          senderDisplayName: 'Bob',
        },
      ],
    })
    const weflow = await parseBrowserImportSource(weflowSource, { formatId: 'weflow', wasmLoader })
    const weflowTs = await parseBrowserImportSource(weflowSource, {
      formatId: 'weflow',
      wasmLoader: async () => null,
    })
    assert.deepEqual(weflow.meta, {
      name: 'WeFlow',
      platform: 'weixin',
      type: 'group',
      groupId: 'room@chatroom',
      groupAvatar: undefined,
      ownerId: 'bob',
    })
    assert.deepEqual(
      weflow.messages.map((message) => message.content),
      ['hello weflow']
    )
    assert.deepEqual(weflow, weflowTs)
  })

  it('falls back to TS when the strict Rust kernel rejects an off-spec ChatLab message', async () => {
    const logs: string[] = []
    const result = await parseBrowserImportSource(
      source('fallback.json', {
        chatlab: { version: '1' },
        meta: { name: 'Fallback', platform: 'wechat', type: 'group' },
        messages: [{ sender: 'alice', timestamp: 1, type: 0, content: 'TS handles the missing account name' }],
      }),
      {
        formatId: 'chatlab',
        wasmLoader,
        onLog: (event) => logs.push(`${event.level}:${event.message}`),
      }
    )

    assert.equal(result.messages[0]?.senderAccountName, 'alice')
    assert.ok(logs.some((message) => message.includes('info:Rust WASM parse failed; falling back to TS')))
  })

  it('falls back to TS when the WASM module cannot initialize', async () => {
    const result = await parseBrowserImportSource(
      source('init-fallback.json', {
        chatlab: { version: '1' },
        meta: { name: 'Init fallback', platform: 'wechat', type: 'group' },
        messages: [{ sender: 'alice', accountName: 'Alice', timestamp: 1, type: 0, content: 'fallback' }],
      }),
      {
        formatId: 'chatlab',
        wasmLoader: async () => {
          throw new Error('WASM initialization failed')
        },
      }
    )

    assert.equal(result.messages[0]?.content, 'fallback')
  })

  it('propagates cancellation after synchronous WASM parsing instead of falling back', async () => {
    let checks = 0
    await assert.rejects(
      parseBrowserImportSource(
        source('cancelled.json', {
          chatlab: { version: '1' },
          meta: { name: 'Cancelled', platform: 'wechat', type: 'group' },
          messages: [{ sender: 'alice', accountName: 'Alice', timestamp: 1, type: 0, content: 'stop' }],
        }),
        {
          formatId: 'chatlab',
          wasmLoader,
          checkCancelled: () => {
            checks += 1
            if (checks >= 3) throw new WebRuntimeError('REQUEST_CANCELLED', 'cancelled')
          },
        }
      ),
      (error: unknown) => error instanceof WebRuntimeError && error.code === 'REQUEST_CANCELLED'
    )
  })
})
