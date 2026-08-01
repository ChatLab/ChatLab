#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const targets = {
  cli: join(repoRoot, 'apps', 'cli', 'dist', 'people-relationships-worker.mjs'),
  desktop: join(repoRoot, 'apps', 'desktop', 'out', 'main', 'people-relationships-worker.js'),
}

function verifyFile(target, artifactPath) {
  if (!existsSync(artifactPath)) {
    throw new Error(`Missing ${target} worker bundle: ${artifactPath}`)
  }
  if (statSync(artifactPath).size === 0) {
    throw new Error(`Empty ${target} worker bundle: ${artifactPath}`)
  }
}

function verifyCliAnalyticsConfig() {
  const endpoint = process.env.UMAMI_ENDPOINT?.trim()
  const websiteId = process.env.UMAMI_WEBSITE_ID?.trim()
  if (!endpoint && !websiteId) return
  if (!endpoint || !websiteId) {
    throw new Error('UMAMI_ENDPOINT and UMAMI_WEBSITE_ID must be configured together')
  }

  const distDir = join(repoRoot, 'apps', 'cli', 'dist')
  const bundledSource = readdirSync(distDir)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => readFileSync(join(distDir, name), 'utf8'))
    .join('\n')

  if (!bundledSource.includes(endpoint) || !bundledSource.includes(websiteId)) {
    throw new Error('CLI build did not inline the configured analytics values')
  }
}

const target = process.argv[2]
const artifactPath = targets[target]

try {
  if (!artifactPath) throw new Error('Usage: node scripts/check-build-artifacts.mjs <cli|desktop>')
  verifyFile(target, artifactPath)
  if (target === 'cli') verifyCliAnalyticsConfig()
  console.log(`[check-build-artifacts] OK: ${target}`)
} catch (error) {
  console.error(`[check-build-artifacts] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
