import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveMcpPackageVersion } from './runtime-version'

test('resolveMcpPackageVersion uses bundled package version instead of npm caller env', () => {
  const previous = process.env.npm_package_version
  process.env.npm_package_version = '9.9.9'

  try {
    assert.equal(resolveMcpPackageVersion('0.25.1'), '0.25.1')
  } finally {
    if (previous === undefined) {
      delete process.env.npm_package_version
    } else {
      process.env.npm_package_version = previous
    }
  }
})
