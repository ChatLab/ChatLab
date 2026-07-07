import * as path from 'path'

export function getImportLogDir(logsDir: string): string {
  return path.join(logsDir, 'import')
}
