export function createChatlabServeCommand({ serverDir, backendPort, nodeExecutable = process.execPath }) {
  return {
    command: nodeExecutable,
    args: ['--watch', '--import', 'tsx', 'src/cli.ts', 'serve', '--port', String(backendPort)],
    options: {
      cwd: serverDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    },
  }
}
