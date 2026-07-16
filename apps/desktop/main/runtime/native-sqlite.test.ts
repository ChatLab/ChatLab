import assert from 'node:assert/strict'
import test from 'node:test'
import * as path from 'node:path'

import {
  findDesktopNativeBinding,
  resolveDesktopNativeBinding,
  resolveElectronNativeBindingPath,
} from './native-sqlite'

const BINDING = path.join('native', 'better_sqlite3.node')

test('findDesktopNativeBinding walks up from dev bundle locations', () => {
  const desktopRoot = path.join('/repo', 'apps', 'desktop')
  const expected = path.join(desktopRoot, BINDING)
  const exists = (candidate: string) => candidate === expected

  // out/main（主进程 bundle）、out/main/chunks（共享 chunk）、out/main/worker（worker bundle）
  assert.equal(findDesktopNativeBinding(path.join(desktopRoot, 'out', 'main'), exists), expected)
  assert.equal(findDesktopNativeBinding(path.join(desktopRoot, 'out', 'main', 'chunks'), exists), expected)
  assert.equal(findDesktopNativeBinding(path.join(desktopRoot, 'out', 'main', 'worker'), exists), expected)
})

test('findDesktopNativeBinding returns undefined when no binding exists (packaged app)', () => {
  const asarDir = path.join('/Applications', 'ChatLab.app', 'Contents', 'Resources', 'app.asar', 'out', 'main')
  assert.equal(
    findDesktopNativeBinding(asarDir, () => false),
    undefined
  )
})

test('findDesktopNativeBinding stops at the filesystem root without hanging', () => {
  let calls = 0
  const exists = () => {
    calls++
    return false
  }
  assert.equal(findDesktopNativeBinding(path.parse(process.cwd()).root, exists), undefined)
  assert.ok(calls <= 5)
})

test('resolveElectronNativeBindingPath prefers packaged resources binding', () => {
  const resourcesPath = path.join('/package', 'resources')
  const packaged = path.join(resourcesPath, BINDING)
  const desktopRoot = path.join('/repo', 'apps', 'desktop')
  const dev = path.join(desktopRoot, BINDING)
  const exists = (candidate: string) => candidate === packaged || candidate === dev

  assert.equal(
    resolveElectronNativeBindingPath({
      startDir: path.join(desktopRoot, 'out', 'main'),
      resourcesPath,
      exists,
    }),
    packaged
  )
})

test('resolveElectronNativeBindingPath falls back to the dev binding', () => {
  const desktopRoot = path.join('/repo', 'apps', 'desktop')
  const dev = path.join(desktopRoot, BINDING)

  assert.equal(
    resolveElectronNativeBindingPath({
      startDir: path.join(desktopRoot, 'out', 'main'),
      resourcesPath: path.join('/Electron.app', 'Contents', 'Resources'),
      exists: (candidate) => candidate === dev,
    }),
    dev
  )
})

test('resolveDesktopNativeBinding returns undefined under plain Node', () => {
  // 测试始终跑在系统 Node（非 Electron）：node_modules 保持 Node ABI，无需注入
  assert.equal(process.versions.electron, undefined)
  assert.equal(resolveDesktopNativeBinding(), undefined)
})
