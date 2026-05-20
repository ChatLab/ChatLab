import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const packageRoot = resolve(import.meta.dirname, '..')
const generatedFiles = ['README.md', 'LICENSE']

await Promise.all(
  generatedFiles.map((file) =>
    rm(resolve(packageRoot, file), { force: true }).catch((error) => {
      console.warn(`[release-docs] Failed to remove ${file}: ${error.message}`)
    })
  )
)
