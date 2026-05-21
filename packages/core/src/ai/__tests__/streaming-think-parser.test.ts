import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { StreamingThinkTagParser, type StreamParserEvent } from '../streaming-think-parser'

function collect(chunks: string[]): StreamParserEvent[] {
  const events: StreamParserEvent[] = []
  const parser = new StreamingThinkTagParser((ev) => events.push(ev))
  for (const chunk of chunks) {
    parser.feed(chunk)
  }
  parser.flush()
  return events
}

describe('StreamingThinkTagParser', () => {
  it('passes through plain text as content', () => {
    const events = collect(['Hello', ' world'])
    assert.deepEqual(events, [
      { type: 'content', content: 'Hello' },
      { type: 'content', content: ' world' },
    ])
  })

  it('detects <think> tag in a single chunk', () => {
    const events = collect(['<think>reasoning</think>answer'])
    assert.deepEqual(events, [
      { type: 'thinking_start', tag: 'think' },
      { type: 'thinking_delta', content: 'reasoning' },
      { type: 'thinking_end' },
      { type: 'content', content: 'answer' },
    ])
  })

  it('handles tag split across chunks', () => {
    const events = collect(['<thi', 'nk>reasoning</think>answer'])
    assert.deepEqual(events, [
      { type: 'thinking_start', tag: 'think' },
      { type: 'thinking_delta', content: 'reasoning' },
      { type: 'thinking_end' },
      { type: 'content', content: 'answer' },
    ])
  })

  it('handles closing tag split across chunks', () => {
    const events = collect(['<think>reasoning</thi', 'nk>answer'])
    assert.deepEqual(events, [
      { type: 'thinking_start', tag: 'think' },
      { type: 'thinking_delta', content: 'reasoning' },
      { type: 'thinking_end' },
      { type: 'content', content: 'answer' },
    ])
  })

  it('handles content before and after think block', () => {
    const events = collect(['before<think>middle</think>after'])
    assert.deepEqual(events, [
      { type: 'content', content: 'before' },
      { type: 'thinking_start', tag: 'think' },
      { type: 'thinking_delta', content: 'middle' },
      { type: 'thinking_end' },
      { type: 'content', content: 'after' },
    ])
  })

  it('handles < that is not a think tag', () => {
    const events = collect(['a < b > c'])
    assert.deepEqual(events, [
      { type: 'content', content: 'a ' },
      { type: 'content', content: '<' },
      { type: 'content', content: ' b > c' },
    ])
  })

  it('handles other think tags like <reasoning>', () => {
    const events = collect(['<reasoning>step 1</reasoning>done'])
    assert.deepEqual(events, [
      { type: 'thinking_start', tag: 'reasoning' },
      { type: 'thinking_delta', content: 'step 1' },
      { type: 'thinking_end' },
      { type: 'content', content: 'done' },
    ])
  })

  it('flushes buffered thinking content on flush()', () => {
    const events: StreamParserEvent[] = []
    const parser = new StreamingThinkTagParser((ev) => events.push(ev))
    parser.feed('<think>partial thinking')
    parser.flush()
    assert.deepEqual(events, [
      { type: 'thinking_start', tag: 'think' },
      { type: 'thinking_delta', content: 'partial thinking' },
    ])
  })

  it('flushes incomplete close tag as thinking content', () => {
    const events: StreamParserEvent[] = []
    const parser = new StreamingThinkTagParser((ev) => events.push(ev))
    parser.feed('<think>content</thi')
    parser.flush()
    assert.deepEqual(events, [
      { type: 'thinking_start', tag: 'think' },
      { type: 'thinking_delta', content: 'content' },
      { type: 'thinking_delta', content: '</thi' },
    ])
  })

  it('handles character-by-character streaming', () => {
    const text = '<think>hi</think>ok'
    const events = collect(text.split(''))
    assert.deepEqual(events, [
      { type: 'thinking_start', tag: 'think' },
      { type: 'thinking_delta', content: 'h' },
      { type: 'thinking_delta', content: 'i' },
      { type: 'thinking_end' },
      { type: 'content', content: 'o' },
      { type: 'content', content: 'k' },
    ])
  })

  it('handles < inside think block that is not closing tag', () => {
    const events = collect(['<think>a < b</think>done'])
    assert.deepEqual(events, [
      { type: 'thinking_start', tag: 'think' },
      { type: 'thinking_delta', content: 'a ' },
      { type: 'thinking_delta', content: '<' },
      { type: 'thinking_delta', content: ' b' },
      { type: 'thinking_end' },
      { type: 'content', content: 'done' },
    ])
  })
})
