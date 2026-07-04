/**
 * `chatlab manifest`: machine-readable command tree generated from commander
 * registration (design §7 discovery). One call replaces N --help probes.
 * Query commands carry full arg/option detail; app-level commands (import,
 * start, ...) are listed by name only and stay out of the query section.
 */

import type { Command } from 'commander'
import { API_VERSION } from './envelope'

/** Command groups that make up the agent-facing query surface. */
const QUERY_GROUPS = new Set(['sessions', 'members', 'messages', 'stats', 'topics', 'sql', 'schema', 'manifest'])

export interface ManifestArg {
  name: string
  required: boolean
  variadic: boolean
  description?: string
}

export interface ManifestOption {
  flags: string
  description: string
  default?: unknown
}

export interface ManifestCommand {
  name: string
  description: string
  args: ManifestArg[]
  options: ManifestOption[]
}

export interface ManifestExample {
  task: string
  command: string
}

export interface Manifest {
  name: string
  version: string
  apiVersion: number
  formats: string[]
  commands: ManifestCommand[]
  appCommands: Array<{ name: string; description: string }>
  exitCodes: Record<string, string>
  examples: ManifestExample[]
  notes: string[]
}

const EXIT_CODES: Record<string, string> = {
  '0': 'success',
  '1': 'internal error',
  '2': 'invalid argument, invalid cursor, or disabled capability',
  '3': 'resource not found (session/member/message/segment)',
  '4': 'ambiguous reference (see error.candidates)',
  '5': 'SQL error',
}

// Curated task recipes (design §13): agent format for message bodies,
// json for structural scouting; --raw never appears here.
const EXAMPLES: ManifestExample[] = [
  { task: 'What did this group talk about today?', command: 'chatlab messages list --since today --format agent' },
  {
    task: 'Search a topic within a time range',
    command: 'chatlab messages search 旅游 --since 2026-01-01 --limit 20 --format agent',
  },
  {
    task: 'Who mentioned it first (message ids)?',
    command: 'chatlab messages search 报销 --sort asc --limit 5 --format agent',
  },
  {
    task: 'Follow up a single [#id] marker with context',
    command: 'chatlab messages context --id 1021 --window 10 --format agent',
  },
  {
    task: 'Conversation between me and a member last month',
    command: 'chatlab messages between --member me --member 小红 --last 30d --format agent',
  },
  { task: 'Most active members', command: 'chatlab stats activity --top 10 --format json' },
  { task: 'Monthly hot topics', command: 'chatlab topics list --since 2026-06-01 --until 2026-06-30 --format agent' },
  { task: 'High-frequency words', command: 'chatlab stats keywords --last 30d --top 20 --format json' },
  {
    task: 'Structural scouting without content',
    command: 'chatlab messages list --last 7d --no-content --fields id,senderName,time --format json',
  },
  { task: 'Discover sessions first', command: 'chatlab sessions list --format json' },
]

const NOTES: string[] = [
  'Always pass --format explicitly: agent for message bodies, json for structural data.',
  'stdout carries exactly one JSON envelope in agent/json mode; logs go to stderr.',
  'Success envelope: { ok, command, data, meta }; failure: { ok: false, command, error }.',
  'Pagination: follow meta.nextCursor with --cursor; cursors are bound to the exact query.',
  'Single-message [#id] and [#id*] markers are usable with `messages context --id`; merged [#a-b] ranges are display-only.',
  'Privacy preprocessing (desensitize/blacklist) is always on by default.',
]

interface CommandLike {
  name(): string
  description(): string
  commands: readonly CommandLike[]
  options: ReadonlyArray<{ flags: string; description: string; defaultValue?: unknown; hidden?: boolean }>
  registeredArguments?: ReadonlyArray<{
    name(): string
    required: boolean
    variadic: boolean
    description?: string
  }>
  _hidden?: boolean
}

function isHidden(cmd: CommandLike): boolean {
  return cmd._hidden === true
}

function serializeCommand(cmd: CommandLike, prefix: string): ManifestCommand {
  const args: ManifestArg[] = (cmd.registeredArguments ?? []).map((arg) => ({
    name: arg.name(),
    required: arg.required,
    variadic: arg.variadic,
    ...(arg.description ? { description: arg.description } : {}),
  }))
  const options: ManifestOption[] = cmd.options
    .filter((opt) => !opt.hidden)
    .map((opt) => ({
      flags: opt.flags,
      description: opt.description,
      ...(opt.defaultValue !== undefined ? { default: opt.defaultValue } : {}),
    }))
  return {
    name: prefix ? `${prefix} ${cmd.name()}` : cmd.name(),
    description: cmd.description(),
    args,
    options,
  }
}

function collectQueryCommands(cmd: CommandLike, prefix: string, into: ManifestCommand[]): void {
  if (cmd.commands.length === 0) {
    into.push(serializeCommand(cmd, prefix))
    return
  }
  const path = prefix ? `${prefix} ${cmd.name()}` : cmd.name()
  for (const sub of cmd.commands) {
    if (isHidden(sub)) continue
    collectQueryCommands(sub, path, into)
  }
}

export function buildManifest(program: Command, version: string): Manifest {
  const commands: ManifestCommand[] = []
  const appCommands: Array<{ name: string; description: string }> = []

  for (const cmd of program.commands as unknown as CommandLike[]) {
    if (isHidden(cmd)) continue
    if (QUERY_GROUPS.has(cmd.name())) {
      collectQueryCommands(cmd, '', commands)
    } else {
      appCommands.push({ name: cmd.name(), description: cmd.description() })
    }
  }

  return {
    name: 'chatlab',
    version,
    apiVersion: API_VERSION,
    formats: ['agent', 'json', 'text'],
    commands,
    appCommands,
    exitCodes: EXIT_CODES,
    examples: EXAMPLES,
    notes: NOTES,
  }
}

export function registerManifestCommand(program: Command, version: string): void {
  program
    .command('manifest')
    .description('Machine-readable command manifest for AI agents (JSON)')
    .action(() => {
      console.log(JSON.stringify(buildManifest(program, version), null, 2))
    })
}
