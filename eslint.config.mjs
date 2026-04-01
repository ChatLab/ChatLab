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
  }
)
