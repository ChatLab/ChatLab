import { defineConfig } from 'vitepress'
import type { DefaultTheme } from 'vitepress'

const enSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'Introduction',
    items: [
      { text: 'What is ChatLab', link: '/intro' },
      { text: 'Quick Start', link: '/quick-start' },
    ],
  },
  {
    text: 'Usage',
    items: [
      { text: 'Export Chat Records', link: '/usage/how-to-export' },
      { text: 'Import Chat Records', link: '/usage/how-to-import' },
      { text: 'Configure AI', link: '/usage/how-to-config-ai' },
      { text: 'Troubleshooting', link: '/usage/troubleshooting' },
    ],
  },
  {
    text: 'Standards',
    items: [
      { text: 'ChatLab Format', link: '/standard/chatlab-format' },
      { text: 'AI Conversion Guide', link: '/standard/ai-converter' },
      { text: 'ChatLab API', link: '/standard/chatlab-api' },
    ],
  },
]

const cnSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '简介',
    items: [
      { text: 'ChatLab 介绍', link: '/cn/intro' },
      { text: '快速上手', link: '/cn/quick-start' },
    ],
  },
  {
    text: '使用指南',
    items: [
      { text: '导出聊天记录', link: '/cn/usage/how-to-export' },
      { text: '导入聊天记录', link: '/cn/usage/how-to-import' },
      { text: '配置 AI', link: '/cn/usage/how-to-config-ai' },
      { text: '故障排查', link: '/cn/usage/troubleshooting' },
      { text: '常见问题', link: '/cn/usage/faq' },
    ],
  },
  {
    text: '适配 ChatLab',
    items: [
      { text: 'ChatLab Format', link: '/cn/standard/chatlab-format' },
      { text: 'AI 辅助转换', link: '/cn/standard/ai-converter' },
      { text: 'ChatLab API', link: '/cn/standard/chatlab-api' },
      { text: 'Push 导入协议', link: '/cn/standard/chatlab-import' },
      { text: 'Pull 远程数据源协议', link: '/cn/standard/chatlab-pull' },
    ],
  },
]

const twSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '簡介',
    items: [
      { text: 'ChatLab 介紹', link: '/tw/intro' },
      { text: '快速上手', link: '/tw/quick-start' },
    ],
  },
  {
    text: '使用指南',
    items: [
      { text: '匯出聊天記錄', link: '/tw/usage/how-to-export' },
      { text: '匯入聊天記錄', link: '/tw/usage/how-to-import' },
      { text: '配置 AI', link: '/tw/usage/how-to-config-ai' },
      { text: '故障排除', link: '/tw/usage/troubleshooting' },
      { text: '常見問題', link: '/tw/usage/faq' },
    ],
  },
  {
    text: '適配 ChatLab',
    items: [
      { text: 'ChatLab Format', link: '/tw/standard/chatlab-format' },
      { text: 'AI 輔助轉換', link: '/tw/standard/ai-converter' },
      { text: 'ChatLab API', link: '/tw/standard/chatlab-api' },
    ],
  },
]

export default defineConfig({
  title: 'ChatLab',
  description: 'A local-first chat analysis tool powered by SQL and AI Agents.',
  cleanUrls: true,
  appearance: true,
  srcExclude: ['README.md', 'README.zh-CN.md'],
  sitemap: {
    hostname: 'https://docs.chatlab.fun',
  },
  rewrites: {
    'en/:rest*': ':rest*',
  },
  themeConfig: {
    logo: '/assets/logo.svg',
    logoLink: 'https://chatlab.fun',
    socialLinks: [{ icon: 'github', link: 'https://github.com/ChatLab/ChatLab' }],
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      description: 'A local-first chat analysis tool powered by SQL and AI Agents.',
      themeConfig: {
        nav: [
          {
            text: 'Home',
            link: 'https://chatlab.fun',
            target: '_self',
            noIcon: true,
          },
          { text: 'Docs', link: '/intro', activeMatch: '^/' },
          {
            text: 'Roadmap',
            link: 'https://chatlab.fun/roadmap/tasks',
            target: '_self',
            noIcon: true,
          },
          {
            text: 'Community',
            link: 'https://chatlab.fun/other/community',
            target: '_self',
            noIcon: true,
          },
        ],
        sidebar: {
          '/': enSidebar,
          '/usage/': enSidebar,
          '/standard/': enSidebar,
        },
        editLink: {
          pattern: 'https://github.com/ChatLab/ChatLab/edit/main/docs/:path',
          text: 'Edit this page on GitHub',
        },
        returnToTopLabel: 'Back to top',
      },
    },
    cn: {
      label: '简体中文',
      lang: 'zh-CN',
      description: '本地化的聊天记录分析工具，通过 SQL 和 AI Agent 回顾你的社交记忆。',
      themeConfig: {
        nav: [
          {
            text: '主页',
            link: 'https://chatlab.fun/cn/',
            target: '_self',
            noIcon: true,
          },
          { text: '文档', link: '/cn/intro', activeMatch: '^/cn/' },
          {
            text: '路线图',
            link: 'https://chatlab.fun/cn/roadmap/tasks',
            target: '_self',
            noIcon: true,
          },
          {
            text: '加入社群',
            link: 'https://chatlab.fun/cn/other/community',
            target: '_self',
            noIcon: true,
          },
        ],
        sidebar: {
          '/cn/': cnSidebar,
          '/cn/usage/': cnSidebar,
          '/cn/standard/': cnSidebar,
        },
        outline: {
          label: '目录',
        },
        editLink: {
          pattern: 'https://github.com/ChatLab/ChatLab/edit/main/docs/:path',
          text: '在 GitHub 上编辑此页',
        },
        returnToTopLabel: '返回顶部',
      },
    },
    tw: {
      label: '繁體中文',
      lang: 'zh-TW',
      description: '本地化的聊天記錄分析工具，透過 SQL 與 AI Agent 回顧你的社交記憶。',
      themeConfig: {
        nav: [
          {
            text: '主頁',
            link: 'https://chatlab.fun/tw/',
            target: '_self',
            noIcon: true,
          },
          { text: '文件', link: '/tw/intro', activeMatch: '^/tw/' },
          {
            text: '路線圖',
            link: 'https://chatlab.fun/tw/roadmap/tasks',
            target: '_self',
            noIcon: true,
          },
          {
            text: '加入社群',
            link: 'https://chatlab.fun/tw/other/community',
            target: '_self',
            noIcon: true,
          },
        ],
        sidebar: {
          '/tw/': twSidebar,
          '/tw/usage/': twSidebar,
          '/tw/standard/': twSidebar,
        },
        outline: {
          label: '目錄',
        },
        editLink: {
          pattern: 'https://github.com/ChatLab/ChatLab/edit/main/docs/:path',
          text: '在 GitHub 上編輯此頁',
        },
        returnToTopLabel: '返回頂部',
      },
    },
  },
})
