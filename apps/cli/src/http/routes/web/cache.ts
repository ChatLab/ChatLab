/**
 * CLI-specific shell helpers for cache routes.
 *
 * Route registration has been migrated to packages/http-routes (shared).
 * Only the platform-specific openDirectoryPath / showPathInFolder functions
 * remain here, injected into HttpRouteContext by the CLI web-route initializer.
 */
import * as path from 'path'
import { execFile } from 'child_process'

type ExecFileRunner = (file: string, args: string[], callback: (error: Error | null) => void) => unknown

function runExecFile(file: string, args: string[], runner: ExecFileRunner = execFile): Promise<void> {
  return new Promise((resolve, reject) => {
    runner(file, args, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

export async function openDirectoryPath(
  dirPath: string,
  platform: NodeJS.Platform = process.platform,
  runner?: ExecFileRunner
): Promise<void> {
  if (platform === 'darwin') {
    await runExecFile('open', [dirPath], runner)
  } else if (platform === 'win32') {
    await runExecFile('explorer.exe', [dirPath], runner)
  } else {
    await runExecFile('xdg-open', [dirPath], runner)
  }
}

export async function showPathInFolder(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
  runner?: ExecFileRunner
): Promise<void> {
  if (platform === 'darwin') {
    await runExecFile('open', ['-R', filePath], runner)
  } else if (platform === 'win32') {
    await runExecFile('explorer.exe', [`/select,${filePath}`], runner)
  } else {
    await runExecFile('xdg-open', [path.dirname(filePath)], runner)
  }
}
