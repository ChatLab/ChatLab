import path from 'path'
import { fileURLToPath } from 'url'

export function resolveCliPath(...segments: string[]): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const packageRoot = path.basename(moduleDir) === 'dist' ? path.dirname(moduleDir) : path.resolve(moduleDir, '..')
  return path.resolve(packageRoot, ...segments)
}
