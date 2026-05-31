/**
 * 端口可用性检测与错误文案
 */

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
    `    • Use another port:   chatlab start --port <port>`,
    `    • Find the process:   lsof -iTCP:${port} -sTCP:LISTEN`,
    ``,
  ].join('\n')
}
