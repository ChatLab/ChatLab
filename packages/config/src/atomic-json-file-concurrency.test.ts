import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

function runJsonWriterProcess(filePath: string, workerIndex: number, count: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--eval',
        `
          require('tsx/cjs/api').register()
          const { readJsonFile, withFileLock, writeJsonFileAtomically } =
            require(process.env.CHATLAB_ATOMIC_JSON_MODULE)
          for (let index = 0; index < Number(process.env.CHATLAB_WRITE_COUNT); index++) {
            withFileLock(process.env.CHATLAB_JSON_PATH, () => {
              const data = readJsonFile(process.env.CHATLAB_JSON_PATH) || { values: [] }
              data.values.push(\`worker-\${process.env.CHATLAB_WORKER_INDEX}-\${index}\`)
              writeJsonFileAtomically(process.env.CHATLAB_JSON_PATH, data)
            })
          }
        `,
      ],
      {
        env: {
          ...process.env,
          CHATLAB_ATOMIC_JSON_MODULE: fileURLToPath(new URL('./atomic-json-file.ts', import.meta.url)),
          CHATLAB_JSON_PATH: filePath,
          CHATLAB_WORKER_INDEX: String(workerIndex),
          CHATLAB_WRITE_COUNT: String(count),
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
      else reject(new Error(`Atomic JSON writer exited with code ${code}: ${stderr}`))
    })
  })
}

test('stale lock recovery keeps concurrent JSON updates serialized', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-atomic-json-stale-lock-'))
  const filePath = path.join(rootDir, 'config.json')
  const lockPath = `${filePath}.lock`
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }))

  fs.writeFileSync(filePath, JSON.stringify({ values: [] }), 'utf-8')
  const staleLockToken = '2147483647:abandoned-lock'
  fs.writeFileSync(lockPath, staleLockToken, 'utf-8')
  const staleTokenHash = createHash('sha256').update(`${lockPath}\0${staleLockToken}`).digest('hex')
  fs.writeFileSync(
    path.join(rootDir, `.chatlab-lock-recovery-${staleTokenHash}`),
    '2147483647:abandoned-recovery',
    'utf-8'
  )

  const workerCount = 8
  const writesPerWorker = 10
  await Promise.all(
    Array.from({ length: workerCount }, (_, workerIndex) =>
      runJsonWriterProcess(filePath, workerIndex, writesPerWorker)
    )
  )

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { values: string[] }
  assert.equal(data.values.length, workerCount * writesPerWorker)
  assert.equal(new Set(data.values).size, workerCount * writesPerWorker)
  assert.deepEqual(
    fs
      .readdirSync(rootDir)
      .filter((name) => name.includes('.lock') || name.startsWith('.chatlab-lock-recovery-') || name.includes('.tmp-')),
    []
  )
})
