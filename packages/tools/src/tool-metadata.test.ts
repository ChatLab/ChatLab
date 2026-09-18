import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_TOOL_REGISTRY, CROSS_CHAT_AGENT_TOOL_REGISTRY, MCP_TOOL_REGISTRY } from './registry'
import { ENGLISH_TOOL_METADATA, getLocalizedToolMetadata } from './tool-metadata'
import type { ToolDefinition } from './types'

/** CJK ideographs plus the CJK / fullwidth punctuation used by the Chinese tool definitions. */
const CHINESE_PATTERN = /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/

type LocalizableTool = Pick<ToolDefinition, 'name' | 'description' | 'inputSchema'>

/** Every tool any runtime can hand to an LLM: session Agent, MCP Server and cross-chat Agent. */
const REGISTERED_TOOLS: LocalizableTool[] = [
  ...AGENT_TOOL_REGISTRY,
  ...MCP_TOOL_REGISTRY,
  ...CROSS_CHAT_AGENT_TOOL_REGISTRY,
].filter((tool, index, tools) => tools.findIndex((other) => other.name === tool.name) === index)

function definitionIsChinese(tool: LocalizableTool): boolean {
  if (CHINESE_PATTERN.test(tool.description)) return true
  return Object.values(tool.inputSchema.properties).some(
    (property) => property.description !== undefined && CHINESE_PATTERN.test(property.description)
  )
}

test('every tool with a Chinese definition has English metadata', () => {
  const missing = REGISTERED_TOOLS.filter((tool) => definitionIsChinese(tool) && !ENGLISH_TOOL_METADATA[tool.name]).map(
    (tool) => tool.name
  )

  assert.deepEqual(missing, [])
})

test('non-Chinese locales never receive Chinese tool or parameter descriptions', () => {
  const chinese: string[] = []

  for (const tool of REGISTERED_TOOLS) {
    const { description, inputSchema } = getLocalizedToolMetadata(tool, 'en-US')
    if (CHINESE_PATTERN.test(description)) chinese.push(`${tool.name} (description)`)
    for (const [name, property] of Object.entries(inputSchema.properties)) {
      if (property.description && CHINESE_PATTERN.test(property.description)) chinese.push(`${tool.name}.${name}`)
    }
  }

  assert.deepEqual(chinese, [])
})

test('Chinese locales keep the original definition text', () => {
  for (const tool of REGISTERED_TOOLS) {
    const localized = getLocalizedToolMetadata(tool, 'zh-CN')

    assert.equal(localized.description, tool.description, tool.name)
    assert.equal(localized.inputSchema, tool.inputSchema, tool.name)
  }
})

test('localization only rewrites descriptions, keeping required fields and untranslated properties', () => {
  for (const tool of REGISTERED_TOOLS) {
    const translations = ENGLISH_TOOL_METADATA[tool.name]?.properties ?? {}
    const { inputSchema } = getLocalizedToolMetadata(tool, 'en-US')

    assert.deepEqual(inputSchema.required, tool.inputSchema.required, tool.name)
    assert.deepEqual(Object.keys(inputSchema.properties), Object.keys(tool.inputSchema.properties), tool.name)

    for (const [name, property] of Object.entries(tool.inputSchema.properties)) {
      const expected = translations[name] ? { ...property, description: translations[name] } : property
      assert.deepEqual(inputSchema.properties[name], expected, `${tool.name}.${name}`)
    }
  }
})
