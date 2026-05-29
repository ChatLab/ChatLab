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
    },
  }
}
