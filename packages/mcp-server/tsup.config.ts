import { defineConfig } from 'tsup'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    bin: 'src/bin.ts',
  },
  format: ['esm'],
  dts: false,
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  splitting: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  platform: 'node',
  define: {
    __MCP_PACKAGE_VERSION__: JSON.stringify(pkg.version),
  },
  noExternal: [/^@openchatlab\//],
  external: ['better-sqlite3', '@node-rs/jieba'],
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'module';",
      "import { dirname as __pathDirname } from 'path';",
      "import { fileURLToPath as __fileURLToPath } from 'url';",
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __pathDirname(__filename);',
    ].join('\n'),
  },
})
