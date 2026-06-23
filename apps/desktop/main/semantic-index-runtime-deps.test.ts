import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopPackageJsonPath = path.resolve(__dirname, '../package.json')

function readDesktopPackageJson(): { dependencies?: Record<string, string> } {
  return JSON.parse(fs.readFileSync(desktopPackageJsonPath, 'utf-8')) as { dependencies?: Record<string, string> }
}

describe('desktop semantic-index runtime dependencies', () => {
  it('declares transformers node runtime packages as direct production dependencies', () => {
    const pkg = readDesktopPackageJson()
    const dependencies = pkg.dependencies ?? {}

    for (const name of ['onnxruntime-common', 'onnxruntime-node', 'sharp']) {
      assert.ok(dependencies[name], `${name} must be a direct desktop dependency for packaged local embeddings`)
    }
  })
})
