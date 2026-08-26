/**
 * 端口可用性检测与错误文案
 */

import * as fs from 'fs/promises'
import * as net from 'net'

/**
 * 检测指定端口在给定 host 上是否可用。
 * 使用 net.createServer() 试探性绑定，无副作用（成功后立即释放）。
 */
export function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false)
      } else {
        reject(err)
      }
    })
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, host)
  })
}

/**
 * 返回端口被占用时统一的友好报错文案。
 */
export function formatPortInUseError(port: number): string {
  return [
    ``,
    `  ✖ Error: port ${port} is already in use.`,
    ``,
    `    Another process (possibly a ChatLab instance) is using this port. You can:`,
    `    • Use another port:   clb web --port <port>`,
    `    • Find the process:   lsof -iTCP:${port} -sTCP:LISTEN`,
    ``,
  ].join('\n')
}

/** Remove a stale Unix socket without replacing a live listener or a non-socket entry. */
export async function prepareUnixSocket(socketPath: string): Promise<void> {
  let stat
  try {
    stat = await fs.lstat(socketPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }

  if (!stat.isSocket()) {
    throw new Error(`Socket path already exists and is not a socket: ${socketPath}`)
  }

  await new Promise<void>((resolve, reject) => {
    const client = net.createConnection(socketPath)
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code !== 'ECONNREFUSED') {
        reject(err)
        return
      }
      fs.unlink(socketPath).then(resolve, reject)
    }
    client.once('error', onError)
    client.once('connect', () => {
      client.removeListener('error', onError)
      client.destroy()
      reject(new Error(`Unix socket is already in use: ${socketPath}`))
    })
  })
}
