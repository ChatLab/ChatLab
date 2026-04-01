/**
 * 侧边栏 Footer 链接配置类型
 */

/**
 * 链接类型
 * - link: 普通外链
 */
export type FooterLinkType = 'link'

/**
 * Footer 链接配置项
 */
export interface FooterLinkConfig {
  /** 唯一标识 */
  id: string
  /** 图标名称（支持 iconify 或 brand:xxx） */
  icon: string
  /** 标题 */
  title: string
  /** 副标题/描述 */
  subtitle: string
  /** 链接类型 */
  type: FooterLinkType
  /** 链接地址 */
  url: string
}

/**
 * 默认的 Footer 链接配置
 */
export const defaultFooterLinks: FooterLinkConfig[] = [
  {
    id: 'website',
    icon: 'heroicons:globe-alt',
    title: '官网',
    subtitle: '下载最新版客户端',
    type: 'link',
    url: 'https://chatlab.fun/cn/',
  },
  {
    id: 'github',
    icon: 'brand:github',
    title: 'Github',
    subtitle: '提交 Issue，反馈 BUG',
    type: 'link',
    url: 'https://github.com/hellodigua/ChatLab',
  },
]
