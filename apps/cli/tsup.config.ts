import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
    'semantic-index-worker': '../../packages/node-runtime/src/semantic-index/worker-thread-entry.ts',
  },
  format: ['esm'],
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  splitting: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  platform: 'node',
  define: {
    'process.env.APTABASE_APP_KEY': JSON.stringify(process.env.APTABASE_APP_KEY || ''),
  },
  noExternal: [/^@openchatlab\//, 'chatlab-mcp', 'stream-json'],
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
