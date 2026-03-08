/**
 * Tests for US-019: Remove Electron-specific code and update TitleBar for web
 *
 * Verifies:
 * 1. electron/ directory is removed
 * 2. No electron imports in src/
 * 3. TitleBar.vue works without window management IPC calls
 * 4. No electron references in package.json or config files
 * 5. No window.electron references in src/
 * 6. electron.vite.config.ts is removed
 * 7. .npmrc has no electron mirror entries
 * 8. eslint.config.mjs has no @electron-toolkit references
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../../..')
const SRC = join(ROOT, 'src')

/**
 * Recursively collect all files matching extensions
 */
function walkFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue
      results.push(...walkFiles(fullPath, extensions))
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath)
    }
  }
  return results
}

describe('US-019: Electron directory removal', () => {
  it('electron/ directory does not exist', () => {
    assert.ok(!existsSync(join(ROOT, 'electron')), 'electron/ directory should be removed')
  })

  it('electron.vite.config.ts does not exist', () => {
    assert.ok(
      !existsSync(join(ROOT, 'electron.vite.config.ts')),
      'electron.vite.config.ts should be removed'
    )
  })

  it('electron-builder.yml does not exist', () => {
    assert.ok(
      !existsSync(join(ROOT, 'electron-builder.yml')),
      'electron-builder.yml should be removed'
    )
  })

  it('out/ directory does not exist (old Electron build output)', () => {
    assert.ok(!existsSync(join(ROOT, 'out')), 'out/ directory should be removed')
  })
})

describe('US-019: No Electron imports in src/', () => {
  const srcFiles = walkFiles(SRC, ['.ts', '.vue'])

  it('has source files to scan', () => {
    assert.ok(srcFiles.length > 0, `Expected source files in ${SRC}`)
  })

  it('no imports from "electron" in any src/ file', () => {
    const violations: string[] = []
    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf-8')
      // Match: import ... from 'electron' or from "electron"
      if (/from\s+['"]electron['"]/.test(content)) {
        violations.push(file.replace(ROOT + '/', ''))
      }
    }
    assert.deepStrictEqual(violations, [], `Files importing from "electron": ${violations.join(', ')}`)
  })

  it('no imports from @electron/ in any src/ file', () => {
    const violations: string[] = []
    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf-8')
      if (/from\s+['"]@electron\//.test(content)) {
        violations.push(file.replace(ROOT + '/', ''))
      }
    }
    assert.deepStrictEqual(violations, [], `Files importing from @electron/: ${violations.join(', ')}`)
  })

  it('no window.electron references in any src/ file', () => {
    const violations: string[] = []
    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf-8')
      if (/window\.electron/.test(content)) {
        violations.push(file.replace(ROOT + '/', ''))
      }
    }
    assert.deepStrictEqual(
      violations,
      [],
      `Files referencing window.electron: ${violations.join(', ')}`
    )
  })

  it('no electron-vite imports in any src/ file', () => {
    const violations: string[] = []
    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf-8')
      if (/from\s+['"]electron-vite['"]/.test(content)) {
        violations.push(file.replace(ROOT + '/', ''))
      }
    }
    assert.deepStrictEqual(
      violations,
      [],
      `Files importing electron-vite: ${violations.join(', ')}`
    )
  })

  it('no @electron-toolkit imports in any src/ file', () => {
    const violations: string[] = []
    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf-8')
      if (/from\s+['"]@electron-toolkit\//.test(content)) {
        violations.push(file.replace(ROOT + '/', ''))
      }
    }
    assert.deepStrictEqual(
      violations,
      [],
      `Files importing @electron-toolkit: ${violations.join(', ')}`
    )
  })
})

describe('US-019: TitleBar component', () => {
  const titleBarPath = join(SRC, 'components/common/TitleBar.vue')

  it('TitleBar.vue exists', () => {
    assert.ok(existsSync(titleBarPath), 'TitleBar.vue should exist')
  })

  it('TitleBar.vue has no window.electron references', () => {
    const content = readFileSync(titleBarPath, 'utf-8')
    assert.ok(
      !/window\.electron/.test(content),
      'TitleBar.vue should not reference window.electron'
    )
  })

  it('TitleBar.vue has no ipcRenderer references', () => {
    const content = readFileSync(titleBarPath, 'utf-8')
    assert.ok(!/ipcRenderer/.test(content), 'TitleBar.vue should not reference ipcRenderer')
  })

  it('TitleBar.vue has no window-minimize/maximize/close IPC calls', () => {
    const content = readFileSync(titleBarPath, 'utf-8')
    assert.ok(
      !/window-minimize|window-maximize|window-close/.test(content),
      'TitleBar.vue should not have window IPC calls'
    )
  })

  it('TitleBar.vue has no window control buttons', () => {
    const content = readFileSync(titleBarPath, 'utf-8')
    // In web app, there should be no window control buttons (minimize/maximize/close)
    assert.ok(
      !/control-btn-close/.test(content),
      'TitleBar.vue should not have close button class'
    )
    assert.ok(
      !/window-controls/.test(content),
      'TitleBar.vue should not have window-controls container'
    )
  })

  it('TitleBar.vue is a valid Vue SFC with script setup', () => {
    const content = readFileSync(titleBarPath, 'utf-8')
    assert.ok(
      content.includes('<script setup'),
      'TitleBar.vue should have <script setup>'
    )
    assert.ok(content.includes('<template>'), 'TitleBar.vue should have <template>')
    assert.ok(content.includes('<style'), 'TitleBar.vue should have <style>')
  })

  it('TitleBar.vue still has platform detection for styling', () => {
    const content = readFileSync(titleBarPath, 'utf-8')
    assert.ok(
      content.includes('navigator.platform'),
      'TitleBar.vue should detect platform for styling'
    )
  })

  it('TitleBar.vue is imported in App.vue', () => {
    const appContent = readFileSync(join(SRC, 'App.vue'), 'utf-8')
    assert.ok(
      appContent.includes("import TitleBar from '@/components/common/TitleBar.vue'"),
      'App.vue should import TitleBar'
    )
    assert.ok(appContent.includes('<TitleBar'), 'App.vue should use TitleBar component')
  })
})

describe('US-019: Package.json clean of electron', () => {
  it('no electron packages in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.optionalDependencies || {}),
    }

    const electronPkgs = Object.keys(allDeps).filter(
      (name) =>
        name === 'electron' ||
        name.startsWith('@electron') ||
        name.startsWith('electron-') ||
        name === '@electron-toolkit/utils' ||
        name === '@electron-toolkit/preload' ||
        name === 'electron-vite'
    )
    assert.deepStrictEqual(
      electronPkgs,
      [],
      `Electron packages found in package.json: ${electronPkgs.join(', ')}`
    )
  })
})

describe('US-019: Config files clean of electron', () => {
  it('.npmrc has no electron mirror entries', () => {
    const npmrc = readFileSync(join(ROOT, '.npmrc'), 'utf-8')
    assert.ok(
      !/electron[-_]mirror/.test(npmrc),
      '.npmrc should not have electron mirror entries'
    )
    assert.ok(
      !/electron_builder/.test(npmrc),
      '.npmrc should not have electron_builder entries'
    )
  })

  it('eslint.config.mjs has no @electron-toolkit references', () => {
    const eslintConfig = readFileSync(join(ROOT, 'eslint.config.mjs'), 'utf-8')
    assert.ok(
      !/@electron-toolkit/.test(eslintConfig),
      'eslint.config.mjs should not reference @electron-toolkit'
    )
  })

  it('tsconfig files have no electron references', () => {
    const tsconfigFiles = ['tsconfig.json', 'tsconfig.node.json', 'tsconfig.web.json', 'tsconfig.server.json']
    for (const file of tsconfigFiles) {
      const filePath = join(ROOT, file)
      if (!existsSync(filePath)) continue
      const content = readFileSync(filePath, 'utf-8')
      assert.ok(
        !/electron/.test(content),
        `${file} should not reference electron`
      )
    }
  })

  it('vite.config.ts exists and does not reference electron', () => {
    const vitePath = join(ROOT, 'vite.config.ts')
    assert.ok(existsSync(vitePath), 'vite.config.ts should exist')
    const content = readFileSync(vitePath, 'utf-8')
    assert.ok(!/electron/.test(content), 'vite.config.ts should not reference electron')
  })
})
