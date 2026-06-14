/**
 * 主进程中文翻译
 *
 * AI 共享翻译从 @openchatlab/node-runtime 导入，Electron 专有翻译在本文件定义。
 */
import aiLocale from '@openchatlab/node-runtime/src/ai/i18n/locales/zh-CN'

export default {
  // ===== 通用 =====
  common: {
    error: '错误',
  },

  // ===== P0: 更新弹窗 =====
  update: {
    newVersionTitle: '发现新版本 v{{version}}',
    newVersionMessage: '发现新版本 v{{version}}',
    newVersionDetail: '是否立即下载并安装新版本？',
    downloadNow: '立即下载',
    cancel: '取消',
    downloadComplete: '下载完成',
    readyToInstall: '新版本已准备就绪，是否现在安装？',
    install: '安装',
    remindLater: '之后提醒',
    installOnQuit: '稍后（应用退出后自动安装）',
    upToDate: '已是最新版本',
  },

  // ===== P0: 文件/目录对话框 =====
  dialog: {
    selectChatFile: '选择聊天记录文件',
    chatRecords: '聊天记录',
    allFiles: '所有文件',
    import: '导入',
    selectDirectory: '选择目录',
    selectFolder: '选择文件夹',
    selectFolderError: '选择文件夹时发生错误：',
  },

  // ===== P1: 数据库迁移 =====
  database: {
    migrationV1Desc: '添加 owner_id 字段到 meta 表',
    migrationV1Message: '支持「Owner」功能，可在成员列表中设置自己的身份',
    migrationV2Desc: '添加 roles、reply_to_message_id、platform_message_id 字段',
    migrationV2Message: '支持成员角色、消息回复关系和回复内容预览',
    migrationV3Desc: '添加会话索引相关表（segment、message_context）和 session_gap_threshold 字段',
    migrationV3Message: '支持会话时间轴浏览和 AI 增强分析功能',
    migrationV4Desc: '创建 FTS5 全文搜索索引（message_fts）并构建索引数据',
    migrationV4Message: '支持全文搜索，大幅提升关键词搜索速度',
    migrationV5Desc: '修复旧版成员和消息字段',
    migrationV5Message: '更新旧版数据库字段以兼容当前版本',
    migrationV6Desc: '将会话索引升级为 segment 结构',
    migrationV6Message: '升级会话索引结构，并保留现有索引和摘要',
    migrationV7Desc: '修复缺失的会话消息关联',
    migrationV7Message: '修复会话索引中缺失的消息关联，并保留现有会话和摘要',
    integrityError: '数据库结构不完整：缺少 meta 表。建议删除此数据库文件后重新导入。',
    checkFailed: '数据库检查失败: {{error}}',
  },

  // ===== 工具系统 =====
  tools: {
    notRegistered: '工具 "{{toolName}}" 未注册',
  },

  // AI shared translations (from @openchatlab/node-runtime)
  ...aiLocale,
}
