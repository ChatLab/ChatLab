import { copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const packageRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(packageRoot, '../..')

const releaseDocs = [
  ['README.md', 'README.md'],
  ['LICENSE', 'LICENSE'],
]

for (const [source, target] of releaseDocs) {
  await copyFile(resolve(repositoryRoot, source), resolve(packageRoot, target))
}
