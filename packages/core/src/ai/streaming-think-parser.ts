/**
 * Streaming think-tag parser.
 *
 * Detects <think>, <reasoning>, etc. tags embedded in streaming text deltas
 * and splits them into separate thinking/content events. Handles tags split
 * across multiple chunks via internal buffering.
 */

import { THINK_TAGS } from './content-parser'

export type StreamParserEvent =
  | { type: 'content'; content: string }
  | { type: 'thinking_start'; tag: string }
  | { type: 'thinking_delta'; content: string }
  | { type: 'thinking_end' }

type ParserState = 'content' | 'thinking'

export class StreamingThinkTagParser {
  private state: ParserState = 'content'
  private buffer = ''
  private activeTag = ''
  private emit: (event: StreamParserEvent) => void

  constructor(emit: (event: StreamParserEvent) => void) {
    this.emit = emit
  }

  feed(text: string): void {
    this.buffer += text
    this.processBuffer()
  }

  /** Flush any remaining buffer (call at stream end). */
  flush(): void {
    if (!this.buffer) return
    if (this.state === 'thinking') {
      this.emit({ type: 'thinking_delta', content: this.buffer })
    } else {
      this.emit({ type: 'content', content: this.buffer })
    }
    this.buffer = ''
  }

  private processBuffer(): void {
    while (this.buffer.length > 0) {
      const ltIdx = this.buffer.indexOf('<')

      if (ltIdx === -1) {
        this.emitBufferContent(this.buffer)
        this.buffer = ''
        return
      }

      if (ltIdx > 0) {
        this.emitBufferContent(this.buffer.slice(0, ltIdx))
        this.buffer = this.buffer.slice(ltIdx)
      }

      // Buffer starts with '<', try to match a tag
      const tagResult = this.tryMatchTag()
      if (tagResult === 'incomplete') {
        // Need more data; keep buffer for next feed()
        return
      }
      if (tagResult === 'matched') {
        // Tag was consumed and events emitted, continue processing
        continue
      }
      // 'no_match': the '<' is not a think tag, emit it and advance
      this.emitBufferContent('<')
      this.buffer = this.buffer.slice(1)
    }
  }

  /**
   * Try to match a think tag at the start of buffer.
   * Returns: 'matched' if a tag was consumed, 'incomplete' if more data
   * needed, 'no_match' if it's not a valid think tag.
   */
  private tryMatchTag(): 'matched' | 'incomplete' | 'no_match' {
    if (this.state === 'content') {
      return this.tryMatchOpenTag()
    }
    return this.tryMatchCloseTag()
  }

  private tryMatchOpenTag(): 'matched' | 'incomplete' | 'no_match' {
    // Look for <tagName> pattern
    for (const tag of THINK_TAGS) {
      const openTag = `<${tag}>`
      if (this.buffer.startsWith(openTag)) {
        this.buffer = this.buffer.slice(openTag.length)
        this.state = 'thinking'
        this.activeTag = tag
        this.emit({ type: 'thinking_start', tag })
        return 'matched'
      }
      // Could be a partial match — check if buffer is a prefix of the tag
      if (openTag.startsWith(this.buffer) && this.buffer.length < openTag.length) {
        return 'incomplete'
      }
    }
    return 'no_match'
  }

  private tryMatchCloseTag(): 'matched' | 'incomplete' | 'no_match' {
    const closeTag = `</${this.activeTag}>`
    if (this.buffer.startsWith(closeTag)) {
      this.buffer = this.buffer.slice(closeTag.length)
      this.state = 'content'
      this.emit({ type: 'thinking_end' })
      this.activeTag = ''
      return 'matched'
    }
    // Could be a partial match
    if (closeTag.startsWith(this.buffer) && this.buffer.length < closeTag.length) {
      return 'incomplete'
    }
    // Not a close tag — emit the '<' as thinking content and continue
    this.emit({ type: 'thinking_delta', content: '<' })
    this.buffer = this.buffer.slice(1)
    return 'matched'
  }

  private emitBufferContent(text: string): void {
    if (!text) return
    if (this.state === 'thinking') {
      this.emit({ type: 'thinking_delta', content: text })
    } else {
      this.emit({ type: 'content', content: text })
    }
  }
}

/**
 * Check if a model likely embeds think tags in content
 * (i.e. uses native <think> output rather than separate reasoning fields).
 */
export function needsStreamingThinkParsing(provider: string, _modelId: string): boolean {
  return provider === 'minimax'
}
