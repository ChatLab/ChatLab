#!/usr/bin/env node
/**
 * Verify the packaged Electron app ships the Rust native parser binary.
 *
 * Usage: node scripts/check-desktop-native.mjs <platform-arch>
 *   e.g. node scripts/check-desktop-native.mjs darwin-arm64
 *        node scripts/check-desktop-native.mjs win32-x64-msvc
 *
 * Scans apps/desktop/dist for app.asar.unpacked directories and requires
 * chatlab-parser-native.<platform-arch>.node to exist (non-empty) inside
 * node_modules/@openchatlab/parser-native. Fails fast so a release without
 * the native kernel never ships silently.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const suffix = process.argv[2]
if (!suffix) {
  console.error('Usage: node scripts/check-desktop-native.mjs <platform-arch> (e.g. darwin-arm64)')
  process.exit(1)
}

const distDir = resolve(import.meta.dirname, '../apps/desktop/dist')
if (!existsSync(distDir)) {
  console.error(`[check-desktop-native] dist directory not found: ${distDir}`)
  process.exit(1)
}

/** Recursively collect app.asar.unpacked directories (bounded depth). */
function findUnpackedDirs(dir, depth = 0, out = []) {
  if (depth > 6) return out
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = join(dir, entry.name)
    if (entry.name === 'app.asar.unpacked') {
      out.push(full)
    } else {
      findUnpackedDirs(full, depth + 1, out)
    }
  }
  return out
}

const unpackedDirs = findUnpackedDirs(distDir)
if (unpackedDirs.length === 0) {
  console.error(`[check-desktop-native] no app.asar.unpacked directory found under ${distDir}`)
  process.exit(1)
}

const expectedFile = `chatlab-parser-native.${suffix}.node`
let ok = false
for (const dir of unpackedDirs) {
  const nodePath = join(dir, 'node_modules', '@openchatlab', 'parser-native', expectedFile)
  if (existsSync(nodePath) && statSync(nodePath).size > 0) {
    console.log(`[check-desktop-native] OK: ${nodePath}`)
    ok = true
  } else {
    console.error(`[check-desktop-native] MISSING: ${nodePath}`)
  }
}

if (!ok) {
  console.error(`[check-desktop-native] packaged app is missing ${expectedFile}; failing the build`)
  process.exit(1)
}
