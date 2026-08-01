import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractThinkingContent, stripToolCallTags } from '../content-parser'

describe('extractThinkingContent', () => {
  const cases = [
    ['returns empty strings for empty input', '', '', ''],
    ['extracts <think> tags', '<think>reasoning here</think>Final answer.', 'reasoning here', 'Final answer.'],
    [
      'extracts multiple different thinking tags',
      '<thinking>step 1</thinking> middle <analysis>step 2</analysis> end',
      'step 1\nstep 2',
      'middle  end',
    ],
    ['is case-insensitive', '<THINK>upper case</THINK>content', 'upper case', 'content'],
    ['handles multiline thinking content', '<reasoning>\nline1\nline2\n</reasoning>done', 'line1\nline2', 'done'],
    ['skips empty thinking tags', '<think>   </think>only content', '', 'only content'],
    ['returns original content when no thinking tags exist', 'just plain text', '', 'just plain text'],
  ] as const

  for (const [name, input, thinking, cleanContent] of cases) {
    it(name, () => {
      assert.deepEqual(extractThinkingContent(input), { thinking, cleanContent })
    })
  }
})

describe('stripToolCallTags', () => {
  const cases = [
    ['removes tool_call tags', 'before<tool_call>{"name":"search"}</tool_call>after', 'beforeafter'],
    ['removes multiple tool_call tags', '<tool_call>a</tool_call> text <tool_call>b</tool_call>', 'text'],
    ['handles multiline tool_call content', 'start\n<tool_call>\n{\n"name": "x"\n}\n</tool_call>\nend', 'start\n\nend'],
    ['returns original text when no tool_call tags', 'no tags here', 'no tags here'],
    ['is case-insensitive', '<TOOL_CALL>data</TOOL_CALL>rest', 'rest'],
  ] as const

  for (const [name, input, expected] of cases) {
    it(name, () => {
      assert.equal(stripToolCallTags(input), expected)
    })
  }
})
