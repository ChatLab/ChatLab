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
  target: 'node20',
  platform: 'node',
  define: {
    'process.env.UMAMI_ENDPOINT': JSON.stringify(process.env.UMAMI_ENDPOINT || ''),
    'process.env.UMAMI_WEBSITE_ID': JSON.stringify(process.env.UMAMI_WEBSITE_ID || ''),
  },
  noExternal: [/^@openchatlab\/(?!parser-native)/, 'chatlab-mcp', 'stream-json'],
  // parser-native 是本地构建的可选 Rust 内核：不打包也不声明依赖，
  // 运行时 require 失败会自动回退 TS 解析器。
  // sqlite-vec / @huggingface/transformers 依赖按平台分发的原生包（sqlite-vec-*、onnxruntime-node、sharp），
  // 必须作为真实依赖随 npm 安装，不能内联进 bundle
  external: ['better-sqlite3', '@node-rs/jieba', 'sqlite-vec', '@huggingface/transformers', '@openchatlab/parser-native'],
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
