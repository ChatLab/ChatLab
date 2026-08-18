import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
    'semantic-index-worker': '../../packages/node-runtime/src/semantic-index/worker-thread-entry.ts',
    'contacts-worker': '../../packages/node-runtime/src/services/contacts/worker-entry.ts',
    'people-relationships-worker': '../../packages/node-runtime/src/services/people/relationships/worker-entry.ts',
    'global-insight-worker': '../../packages/node-runtime/src/services/global-insight/worker-entry.ts',
  },
  format: ['esm'],
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  splitting: true,
  sourcemap: true,
  clean: true,
  target: 'node22',
  platform: 'node',
  define: {
    'process.env.UMAMI_ENDPOINT': JSON.stringify(process.env.UMAMI_ENDPOINT || ''),
    'process.env.UMAMI_WEBSITE_ID': JSON.stringify(process.env.UMAMI_WEBSITE_ID || ''),
  },
  noExternal: [/^@openchatlab\/(?!parser-native)/, 'chatlab-mcp', 'stream-json'],
  // parser-native 是本地构建的可选 Rust 内核：不打包也不声明依赖，
  // 运行时 require 失败会自动回退 TS 解析器。
  // sqlite-vec resolves its platform extension through sqlite-vec-* and must remain an external production dependency.
  // Transformers is supplied by the CLI-managed local embedding runtime or preinstalled by the Docker image.
  // Keeping it external avoids adding the full ONNX runtime to every normal CLI installation.
  external: [
    'better-sqlite3',
    '@node-rs/jieba',
    'sqlite-vec',
    '@openchatlab/parser-native',
    '@huggingface/transformers',
  ],
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
