import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import vuePrettierConfig from '@vue/eslint-config-prettier'
import globals from 'globals'

export default defineConfigWithVueTs(
  {
    ignores: ['node_modules', 'dist', 'out', '.gitignore'],
  },

  // ESLint 推荐规则
  js.configs.recommended,

  // Vue 3 推荐规则（flat config 格式）
  ...pluginVue.configs['flat/recommended'],

  // Vue + TypeScript 推荐规则
  vueTsConfigs.recommended,

  // 全局环境变量（替代 @electron-toolkit 基础配置中的 env 设置）
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.commonjs,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },

  // Prettier（@vue/eslint-config-prettier v10+ 已是 flat config 格式）
  vuePrettierConfig,

  // 自定义规则
  {
    rules: {
      // Vue 规则放宽
      'vue/require-default-prop': 'off',
      'vue/multi-word-component-names': 'off',
      // 项目中有受控的 HTML 渲染场景（如 Markdown/高亮结果），统一关闭该告警。
      'vue/no-v-html': 'off',

      // TypeScript 规则放宽（项目约定）
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',

      // 来自 @electron-toolkit/eslint-config-ts/eslint-recommended
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': 'allow-with-description' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-var-requires': 'off',
    },
  },

  // E2E Node helper/test 使用 CommonJS，允许 require
  {
    files: ['tests/e2e/**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // desktop 侧 better-sqlite3 必须显式携带 Electron-ABI nativeBinding，
  // 否则 dev 环境会加载 node_modules 的 Node ABI 绑定并触发 NODE_MODULE_VERSION 报错。
  // 新代码请优先走统一入口：worker 用 dbCore openRawDatabase()/openDatabase()，
  // 主进程用 database/core 的 openDatabase()/createDatabase()。
  {
    files: ['apps/desktop/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Database']:not(:has(Property[key.name='nativeBinding']))",
          message:
            'Desktop new Database() must pass nativeBinding. Use dbCore openRawDatabase()/openDatabase() in workers, or database/core helpers (resolveDesktopNativeBinding()) in the main process.',
        },
      ],
    },
  },

  // Standalone browser runtime and browser service adapters must not pull in
  // Electron, Node-only runtimes, AI runtimes, or CLI backend implementation.
  {
    files: ['packages/web-runtime/src/**/*.ts', 'src/services/**/browser.ts'],
    ignores: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: 'Standalone browser code cannot depend on Electron.',
            },
            {
              name: '@openchatlab/node-runtime',
              message: 'Standalone browser code cannot depend on the Node runtime.',
            },
            {
              name: '@openchatlab/http-routes',
              message: 'Standalone browser code cannot depend on HTTP server routes.',
            },
            {
              name: '@openchatlab/tools',
              message: 'Standalone browser MVP does not include the AI tool runtime.',
            },
            {
              name: '@openchatlab/config',
              message: 'Standalone browser code cannot depend on the Node-backed config package.',
            },
            {
              name: '@openchatlab/parser',
              message: 'Browser code must use an explicit browser-safe parser subpath, not the Node file-path parser.',
            },
          ],
          patterns: [
            {
              group: ['node:*', '@electron/*', '**/apps/cli/**', '@/services/ai/**'],
              message: 'Standalone browser runtime and adapters must stay browser-only.',
            },
            {
              group: ['@openchatlab/parser/src/**'],
              message: 'Standalone browser code must use the public @openchatlab/parser/browser entrypoint.',
            },
          ],
        },
      ],
    },
  }
)
