/**
 * Tests for the machine-readable command manifest: one call replaces N --help
 * probes. Hidden legacy aliases stay out, option defaults and subcommand paths
 * are serialized, and the exit code table matches the envelope contract.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Command } from 'commander'
import { buildManifest } from './manifest'

function buildProgram(): Command {
  const program = new Command()
  program.name('chatlab').description('test program')

  const messages = program.command('messages').description('Query messages')
  messages
    .command('search')
    .description('Search messages by keywords')
    .argument('<keywords...>', 'Search keywords')
    .option('--match <mode>', 'any | all', 'any')
    .option('--limit <n>', 'Hits per page (default 20, max 500)')

  program
    .command('search <session-id> <keyword>', { hidden: true })
    .description('Deprecated alias')
    .option('--limit <n>', 'Max results', '20')

  program.command('import <file>').description('Import a chat history file')

  return program
}

describe('buildManifest', () => {
  const manifest = buildManifest(buildProgram(), '1.2.3')

  it('serializes nested query commands with args, options and defaults', () => {
    const search = manifest.commands.find((c) => c.name === 'messages search')
    assert.ok(search, 'messages search should be present')
    assert.deepEqual(search.args, [
      { name: 'keywords', required: true, variadic: true, description: 'Search keywords' },
    ])
    const match = search.options.find((o) => o.flags === '--match <mode>')
    assert.equal(match?.default, 'any')
    assert.ok(search.options.some((o) => o.flags === '--limit <n>'))
  })

  it('excludes hidden legacy aliases', () => {
    assert.ok(!manifest.commands.some((c) => c.name.startsWith('search')))
  })

  it('lists non-query commands by name only', () => {
    assert.ok(manifest.appCommands.some((c) => c.name === 'import'))
    assert.ok(!manifest.commands.some((c) => c.name === 'import'))
  })

  it('carries the envelope contract: exit codes, formats and version', () => {
    assert.equal(manifest.version, '1.2.3')
    assert.equal(manifest.apiVersion, 1)
    assert.deepEqual(manifest.formats, ['agent', 'json', 'text'])
    assert.equal(manifest.exitCodes['0'], 'success')
    assert.equal(manifest.exitCodes['4'], 'ambiguous reference (see error.candidates)')
  })

  it('ships curated examples without --raw', () => {
    assert.ok(manifest.examples.length >= 5)
    assert.ok(manifest.examples.every((e) => !e.command.includes('--raw')))
    assert.ok(manifest.examples.some((e) => e.command.includes('--format agent')))
  })
})
