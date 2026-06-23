import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const releaseWorkflow = readFileSync(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf-8')

function extractSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `Missing workflow section: ${startMarker}`)

  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `Missing workflow section terminator: ${endMarker}`)

  return source.slice(start, end)
}

test('release CLI build injects the Aptabase app key before tsup inlines env values', () => {
  const buildCliJob = extractSection(releaseWorkflow, '  build-cli:', '  release:')
  const buildCliStep = extractSection(
    buildCliJob,
    '      - name: Build CLI (with Web UI)',
    '      - name: Upload CLI build output'
  )

  assert.match(buildCliStep, /run: pnpm --filter chatlab-cli run build:full/)
  assert.match(buildCliStep, /APTABASE_APP_KEY: \$\{\{ secrets\.APTABASE_APP_KEY \}\}/)
})
