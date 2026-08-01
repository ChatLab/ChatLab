import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { appLogger } from '../../logging/app-logger'

export const LOCAL_EMBEDDING_RUNTIME_PACKAGE = '@huggingface/transformers'
export const LOCAL_EMBEDDING_RUNTIME_VERSION = '4.2.0'

export type LocalEmbeddingRuntimeInstallMode = 'auto' | 'preinstalled'
export type LocalEmbeddingRuntimeStatus = 'idle' | 'installing' | 'ready' | 'error'

export interface LocalEmbeddingRuntimeConfig {
  baseDir: string
  installMode: LocalEmbeddingRuntimeInstallMode
}

interface LocalEmbeddingRuntimeManifest {
  formatVersion: 1
  packageName: typeof LOCAL_EMBEDDING_RUNTIME_PACKAGE
  packageVersion: typeof LOCAL_EMBEDDING_RUNTIME_VERSION
  platform: string
  arch: string
}

interface InstallCommand {
  command: string
  args: string[]
  cwd: string
}

export interface LocalEmbeddingRuntimeManagerOptions extends LocalEmbeddingRuntimeConfig {
  platform?: string
  arch?: string
  npmCommand?: string
  runInstall?: (input: InstallCommand) => Promise<void>
  verifyStagedRuntime?: (runtimeDir: string) => Promise<void>
  verifyRuntime?: (runtimeDir: string) => Promise<void>
  importTransformers?: (runtimeDir: string) => Promise<typeof import('@huggingface/transformers')>
}

const RUNTIME_MANIFEST_FILE = 'runtime.json'

const VERIFY_RUNTIME_SCRIPT = `
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [, runtimeDir, transformersPackage] = process.argv
const runtimeRequire = createRequire(path.join(runtimeDir, 'package.json'))
const importFromRuntime = async (packageName) => {
  const resolved = runtimeRequire.resolve(packageName)
  return await import(pathToFileURL(resolved).href)
}

const transformers = await importFromRuntime(transformersPackage)
if (typeof transformers.pipeline !== 'function' || typeof transformers.env !== 'object') {
  throw new Error('Installed Transformers runtime does not expose the expected Node API.')
}

const onnxRuntime = await importFromRuntime('onnxruntime-node')
if (typeof onnxRuntime.listSupportedBackends !== 'function') {
  throw new Error('Installed ONNX runtime does not expose listSupportedBackends().')
}
`

function executeInstall(input: InstallCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      input.command,
      input.args,
      {
        cwd: input.cwd,
        env: { ...process.env, npm_config_update_notifier: 'false' },
        maxBuffer: 10 * 1024 * 1024,
        shell: process.platform === 'win32',
      },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve()
          return
        }
        reject(new Error(stderr.trim() || error.message, { cause: error }))
      }
    )
  })
}

function verifyRuntimeInSubprocess(runtimeDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['--input-type=module', '--eval', VERIFY_RUNTIME_SCRIPT, runtimeDir, LOCAL_EMBEDDING_RUNTIME_PACKAGE],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve()
          return
        }
        reject(new Error(stderr.trim() || error.message, { cause: error }))
      }
    )
  })
}

function createRuntimeRequire(runtimeDir: string): NodeJS.Require {
  return createRequire(path.join(runtimeDir, 'package.json'))
}

async function importFromRuntime(runtimeDir: string, packageName: string): Promise<Record<string, unknown>> {
  const resolved = createRuntimeRequire(runtimeDir).resolve(packageName)
  return (await import(pathToFileURL(resolved).href)) as Record<string, unknown>
}

async function verifyInstalledRuntime(runtimeDir: string): Promise<void> {
  const transformers = await importFromRuntime(runtimeDir, LOCAL_EMBEDDING_RUNTIME_PACKAGE)
  if (typeof transformers.pipeline !== 'function' || typeof transformers.env !== 'object') {
    throw new Error('Installed Transformers runtime does not expose the expected Node API.')
  }

  const onnxRuntime = await importFromRuntime(runtimeDir, 'onnxruntime-node')
  if (typeof onnxRuntime.listSupportedBackends !== 'function') {
    throw new Error('Installed ONNX runtime does not expose listSupportedBackends().')
  }
}

async function loadInstalledTransformers(runtimeDir: string): Promise<typeof import('@huggingface/transformers')> {
  return (await importFromRuntime(
    runtimeDir,
    LOCAL_EMBEDDING_RUNTIME_PACKAGE
  )) as unknown as typeof import('@huggingface/transformers')
}

export class LocalEmbeddingRuntimeManager {
  private readonly baseDir: string
  private readonly installMode: LocalEmbeddingRuntimeInstallMode
  private readonly platform: string
  private readonly arch: string
  private readonly npmCommand: string
  private readonly runInstall: (input: InstallCommand) => Promise<void>
  private readonly verifyStagedRuntime: (runtimeDir: string) => Promise<void>
  private readonly verifyRuntime: (runtimeDir: string) => Promise<void>
  private readonly importTransformers: (runtimeDir: string) => Promise<typeof import('@huggingface/transformers')>

  private status: LocalEmbeddingRuntimeStatus
  private installPromise: Promise<string> | null = null
  private transformersPromise: Promise<typeof import('@huggingface/transformers')> | null = null
  private verifiedRuntimeDir: string | null = null

  constructor(options: LocalEmbeddingRuntimeManagerOptions) {
    this.baseDir = options.baseDir
    this.installMode = options.installMode
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.npmCommand = options.npmCommand ?? (this.platform === 'win32' ? 'npm.cmd' : 'npm')
    this.runInstall = options.runInstall ?? executeInstall
    this.verifyStagedRuntime = options.verifyStagedRuntime ?? verifyRuntimeInSubprocess
    this.verifyRuntime = options.verifyRuntime ?? verifyInstalledRuntime
    this.importTransformers = options.importTransformers ?? loadInstalledTransformers
    this.status = 'idle'
  }

  getStatus(): LocalEmbeddingRuntimeStatus {
    return this.status
  }

  getRuntimeDir(): string {
    return path.join(this.baseDir, `transformers-${LOCAL_EMBEDDING_RUNTIME_VERSION}`, `${this.platform}-${this.arch}`)
  }

  async ensureInstalled(): Promise<string> {
    if (!this.installPromise) {
      this.installPromise = this.ensureInstalledOnce().finally(() => {
        this.installPromise = null
      })
    }
    return await this.installPromise
  }

  async loadTransformers(): Promise<typeof import('@huggingface/transformers')> {
    if (!this.transformersPromise) {
      this.transformersPromise = this.ensureInstalled()
        .then((runtimeDir) => this.importTransformers(runtimeDir))
        .catch((error) => {
          this.transformersPromise = null
          throw error
        })
    }
    return await this.transformersPromise
  }

  private async ensureInstalledOnce(): Promise<string> {
    const runtimeDir = this.getRuntimeDir()
    try {
      if (this.hasCompleteLayout(runtimeDir)) {
        try {
          await this.verifyOnce(runtimeDir)
          this.status = 'ready'
          return runtimeDir
        } catch (error) {
          if (this.installMode === 'preinstalled') throw error
          appLogger.warn('semantic-index', 'Existing local embedding runtime is invalid; reinstalling', {
            packageVersion: LOCAL_EMBEDDING_RUNTIME_VERSION,
            platform: this.platform,
            arch: this.arch,
            error: error instanceof Error ? error.message : String(error),
          })
          fs.rmSync(runtimeDir, { recursive: true, force: true })
          this.verifiedRuntimeDir = null
        }
      }

      if (this.installMode === 'preinstalled') {
        throw new Error(`Preinstalled local embedding runtime is missing or incomplete: ${runtimeDir}`)
      }

      this.status = 'installing'
      appLogger.info('semantic-index', 'Local embedding runtime installation started', {
        packageVersion: LOCAL_EMBEDDING_RUNTIME_VERSION,
        platform: this.platform,
        arch: this.arch,
      })

      await this.installAtomically(runtimeDir)
      await this.verifyOnce(runtimeDir)
      this.status = 'ready'
      appLogger.info('semantic-index', 'Local embedding runtime installation completed', {
        packageVersion: LOCAL_EMBEDDING_RUNTIME_VERSION,
        platform: this.platform,
        arch: this.arch,
      })
      return runtimeDir
    } catch (error) {
      this.status = 'error'
      appLogger.error('semantic-index', 'Local embedding runtime installation failed', error)
      throw error
    }
  }

  private async installAtomically(runtimeDir: string): Promise<void> {
    const parentDir = path.dirname(runtimeDir)
    fs.mkdirSync(parentDir, { recursive: true })
    const stagingDir = fs.mkdtempSync(path.join(parentDir, '.installing-'))

    try {
      fs.writeFileSync(
        path.join(stagingDir, 'package.json'),
        `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
        'utf8'
      )
      await this.runInstall({
        command: this.npmCommand,
        args: [
          'install',
          '--omit=dev',
          '--no-audit',
          '--no-fund',
          '--save-exact',
          '--loglevel=error',
          '--prefix',
          stagingDir,
          `${LOCAL_EMBEDDING_RUNTIME_PACKAGE}@${LOCAL_EMBEDDING_RUNTIME_VERSION}`,
        ],
        cwd: stagingDir,
      })
      // Keep native modules in a disposable process so Windows releases DLL handles before the directory rename.
      await this.verifyStagedRuntime(stagingDir)
      fs.writeFileSync(path.join(stagingDir, RUNTIME_MANIFEST_FILE), `${JSON.stringify(this.manifest(), null, 2)}\n`)

      if (fs.existsSync(runtimeDir)) {
        if (this.hasCompleteLayout(runtimeDir)) return
        fs.rmSync(runtimeDir, { recursive: true, force: true })
      }
      try {
        fs.renameSync(stagingDir, runtimeDir)
      } catch (error) {
        // Another ChatLab process may have completed the same atomic install first.
        if (!this.hasCompleteLayout(runtimeDir)) throw error
      }
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true })
    }
  }

  private async verifyOnce(runtimeDir: string): Promise<void> {
    if (this.verifiedRuntimeDir === runtimeDir) return
    await this.verifyRuntime(runtimeDir)
    this.verifiedRuntimeDir = runtimeDir
  }

  private hasCompleteLayout(runtimeDir: string): boolean {
    const manifestPath = path.join(runtimeDir, RUNTIME_MANIFEST_FILE)
    const packagePath = path.join(runtimeDir, 'node_modules', '@huggingface', 'transformers', 'package.json')
    if (!fs.existsSync(manifestPath) || !fs.existsSync(packagePath)) return false
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Partial<LocalEmbeddingRuntimeManifest>
      const expected = this.manifest()
      return (
        manifest.formatVersion === expected.formatVersion &&
        manifest.packageName === expected.packageName &&
        manifest.packageVersion === expected.packageVersion &&
        manifest.platform === expected.platform &&
        manifest.arch === expected.arch
      )
    } catch {
      return false
    }
  }

  private manifest(): LocalEmbeddingRuntimeManifest {
    return {
      formatVersion: 1,
      packageName: LOCAL_EMBEDDING_RUNTIME_PACKAGE,
      packageVersion: LOCAL_EMBEDDING_RUNTIME_VERSION,
      platform: this.platform,
      arch: this.arch,
    }
  }
}

export function createLocalEmbeddingRuntimeManager(
  options: LocalEmbeddingRuntimeManagerOptions
): LocalEmbeddingRuntimeManager {
  return new LocalEmbeddingRuntimeManager(options)
}
