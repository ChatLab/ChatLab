import { spawnSync } from 'node:child_process'

export function createChatlabStartCommand({ serverDir, backendPort, nodeExecutable = process.execPath }) {
  return {
    command: nodeExecutable,
    args: [
      '--watch',
      '--import',
      'tsx',
      'src/cli.ts',
      'start',
      '--headless',
      '--no-open',
      '--port',
      String(backendPort),
    ],
    options: {
      cwd: serverDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      detached: true,
    },
  }
}

export function terminateChatlabStartProcess(
  childProcess,
  { platform = process.platform, killProcess = process.kill, spawnSyncFn = spawnSync } = {}
) {
  if (!childProcess) return
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return

  const pid = childProcess.pid
  if (!pid) {
    childProcess.kill('SIGTERM')
    return
  }

  if (platform === 'win32') {
    const result = spawnSyncFn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    if (result.status === 0) return
    childProcess.kill('SIGTERM')
    return
  }

  try {
    killProcess(-pid, 'SIGTERM')
  } catch {
    childProcess.kill('SIGTERM')
  }
}
