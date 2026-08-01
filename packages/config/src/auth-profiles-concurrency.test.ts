import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { AuthProfilesData } from './auth-profiles'

function runAuthProfileWriterProcess(
  homeDir: string,
  workerIndex: number,
  count: number,
  uniqueBaseName?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--eval',
        `
          require('tsx/cjs/api').register()
          const { writeAuthProfile, writeAuthProfileWithUniqueName } = require(process.env.CHATLAB_AUTH_PROFILES_MODULE)
          for (let index = 0; index < Number(process.env.CHATLAB_PROFILE_COUNT); index++) {
            const profile = {
              type: 'api_key',
              provider: 'openai',
              key: \`secret-\${process.env.CHATLAB_WORKER_INDEX}-\${index}\`,
            }
            if (process.env.CHATLAB_UNIQUE_BASE_NAME) {
              writeAuthProfileWithUniqueName(process.env.CHATLAB_UNIQUE_BASE_NAME, profile)
            } else {
              writeAuthProfile(\`worker-\${process.env.CHATLAB_WORKER_INDEX}-\${index}\`, profile)
            }
          }
        `,
      ],
      {
        env: {
          ...process.env,
          CHATLAB_AUTH_PROFILES_MODULE: fileURLToPath(new URL('./auth-profiles.ts', import.meta.url)),
          CHATLAB_PROFILE_COUNT: String(count),
          CHATLAB_WORKER_INDEX: String(workerIndex),
          ...(uniqueBaseName ? { CHATLAB_UNIQUE_BASE_NAME: uniqueBaseName } : {}),
          HOME: homeDir,
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      }
    )
    let stderr = ''
    child.stderr.setEncoding('utf-8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Auth profile writer exited with code ${code}: ${stderr}`))
    })
  })
}

test('auth profile writes preserve updates from concurrent runtime instances', async (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-auth-profiles-concurrent-'))
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }))

  const workerCount = 4
  const profilesPerWorker = 20
  await Promise.all(
    Array.from({ length: workerCount }, (_, workerIndex) =>
      runAuthProfileWriterProcess(homeDir, workerIndex, profilesPerWorker)
    )
  )

  const configDir = path.join(homeDir, '.chatlab')
  const data = JSON.parse(fs.readFileSync(path.join(configDir, 'auth-profiles.json'), 'utf-8')) as AuthProfilesData
  assert.equal(Object.keys(data.profiles).length, workerCount * profilesPerWorker)
  assert.deepEqual(
    fs
      .readdirSync(configDir)
      .filter((name) => name.includes('.lock') || name.startsWith('.chatlab-lock-recovery-') || name.includes('.tmp-')),
    []
  )
})

test('unique auth profile writes allocate distinct names across concurrent runtime instances', async (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-auth-profiles-unique-concurrent-'))
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }))

  const workerCount = 4
  const profilesPerWorker = 8
  await Promise.all(
    Array.from({ length: workerCount }, (_, workerIndex) =>
      runAuthProfileWriterProcess(homeDir, workerIndex, profilesPerWorker, 'shared')
    )
  )

  const configDir = path.join(homeDir, '.chatlab')
  const data = JSON.parse(fs.readFileSync(path.join(configDir, 'auth-profiles.json'), 'utf-8')) as AuthProfilesData
  const expectedCount = workerCount * profilesPerWorker
  assert.equal(Object.keys(data.profiles).length, expectedCount)
  assert.equal(new Set(Object.values(data.profiles).map((profile) => profile.key)).size, expectedCount)
  assert.ok(data.profiles.shared)
  assert.ok(data.profiles[`shared-${expectedCount}`])
  assert.deepEqual(
    fs
      .readdirSync(configDir)
      .filter((name) => name.includes('.lock') || name.startsWith('.chatlab-lock-recovery-') || name.includes('.tmp-')),
    []
  )
})
