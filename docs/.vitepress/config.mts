import { defineConfig } from 'vitepress'
import type { DefaultTheme } from 'vitepress'

const enSidebar: DefaultTheme.SidebarItem[] = [
  { text: 'Introduction', link: '/' },
  { text: 'Quick Start', link: '/usage/quick-start' },
  {
    text: 'Installation & Deployment',
    items: [
      { text: 'Install ChatLab', link: '/usage/installation' },
      { text: 'Docker Deployment', link: '/usage/docker' },
    ],
  },
  {
    text: 'Usage Guide',
    items: [
      { text: 'Export Chat Records', link: '/usage/how-to-export' },
      { text: 'Import Chat Records', link: '/usage/how-to-import' },
      { text: 'Troubleshooting', link: '/usage/troubleshooting' },
    ],
  },
  {
    text: 'AI Analysis',
    items: [
      { text: 'Why ChatLab', link: '/ai/why-chatlab' },
      { text: 'Analyze with Built-in AI', link: '/ai/chatlab-ai' },
      { text: 'Analyze with an External AI Agent', link: '/ai/external-agent' },
    ],
  },
  {
    text: 'Integrate with ChatLab',
    items: [
      { text: 'ChatLab Format', link: '/standard/chatlab-format' },
      { text: 'AI Conversion Guide', link: '/standard/ai-converter' },
      { text: 'ChatLab API', link: '/standard/chatlab-api' },
    ],
  },
  {
    text: 'Contributing',
    items: [{ text: 'Development Guide', link: '/contributing/development' }],
  },
  { text: 'Acknowledgments', link: '/contributing/acknowledgments' },
]

const cnSidebar: DefaultTheme.SidebarItem[] = [
  { text: 'ChatLab 介绍', link: '/cn/' },
  { text: '快速开始', link: '/cn/usage/quick-start' },
  {
    text: '安装与部署',
    items: [
      { text: '安装 ChatLab', link: '/cn/usage/installation' },
      { text: 'Docker 部署', link: '/cn/usage/docker' },
    ],
  },
  {
    text: '使用指南',
    items: [
      { text: '导出聊天记录', link: '/cn/usage/how-to-export' },
      { text: '导入聊天记录', link: '/cn/usage/how-to-import' },
      { text: '故障排查', link: '/cn/usage/troubleshooting' },
      { text: '常见问题', link: '/cn/usage/faq' },
    ],
  },
  {
    text: 'AI 分析',
    items: [
      { text: '为什么选择 ChatLab', link: '/cn/ai/why-chatlab' },
      { text: '使用内置 AI 分析', link: '/cn/ai/chatlab-ai' },
      { text: '使用外部 AI Agent 分析', link: '/cn/ai/external-agent' },
    ],
  },
  {
    text: '对接 ChatLab',
    items: [
      { text: 'ChatLab Format', link: '/cn/standard/chatlab-format' },
      { text: 'AI 辅助转换', link: '/cn/standard/ai-converter' },
      { text: 'ChatLab API', link: '/cn/standard/chatlab-api' },
      { text: 'Push 导入协议', link: '/cn/standard/chatlab-import' },
      { text: 'Pull 远程数据源协议', link: '/cn/standard/chatlab-pull' },
    ],
  },
  {
    text: '贡献',
    items: [{ text: '开发指南', link: '/cn/contributing/development' }],
  },
  { text: '致谢', link: '/cn/contributing/acknowledgments' },
]

const twSidebar: DefaultTheme.SidebarItem[] = [
  { text: 'ChatLab 介紹', link: '/tw/' },
  { text: '快速開始', link: '/tw/usage/quick-start' },
  {
    text: '安裝與部署',
    items: [
      { text: '安裝 ChatLab', link: '/tw/usage/installation' },
      { text: 'Docker 部署', link: '/tw/usage/docker' },
    ],
  },
  {
    text: '使用指南',
    items: [
      { text: '匯出聊天記錄', link: '/tw/usage/how-to-export' },
      { text: '匯入聊天記錄', link: '/tw/usage/how-to-import' },
      { text: '故障排除', link: '/tw/usage/troubleshooting' },
      { text: '常見問題', link: '/tw/usage/faq' },
    ],
  },
  {
    text: 'AI 分析',
    items: [
      { text: '為什麼選擇 ChatLab', link: '/tw/ai/why-chatlab' },
      { text: '使用內建 AI 分析', link: '/tw/ai/chatlab-ai' },
    ],
  },
  {
    text: '對接 ChatLab',
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
  head: [
    [
      'script',
      {},
      `
    var _hmt = _hmt || [];
    (function() {
      var hm = document.createElement("script");
      hm.src = "https://hm.baidu.com/hm.js?adea56ed261a02133c38250af3a6f7b6";
      var s = document.getElementsByTagName("script")[0];
      s.parentNode.insertBefore(hm, s);
    })();
    `,
    ],
  ],
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
          { text: 'Docs', link: '/', activeMatch: '^/$' },
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
          '/ai/': enSidebar,
          '/standard/': enSidebar,
          '/contributing/': enSidebar,
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
          { text: '文档', link: '/cn/', activeMatch: '^/cn/$' },
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
          '/cn/ai/': cnSidebar,
          '/cn/standard/': cnSidebar,
          '/cn/contributing/': cnSidebar,
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
          { text: '文件', link: '/tw/', activeMatch: '^/tw/$' },
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
          '/tw/ai/': twSidebar,
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
