/**
 * 路径提供器抽象接口
 *
 * 统一不同运行环境下的目录路径获取方式：
 * - Electron：主进程 paths.ts 实现
 * - Node 独立运行：NodePathProvider 实现
 *
 * 目录分为两类：
 *
 * 1. 系统数据（固定在 ~/.chatlab/，不可更改）：
 *    ~/.chatlab/
 *      ├── config.toml
 *      ├── ai/            AI 对话历史、助手/技能/LLM 配置
 *      ├── settings/      用户界面偏好
 *      ├── cache/         派生数据缓存（可再生）
 *      ├── temp/          临时文件
 *      └── logs/          日志
 *
 * 2. 用户核心数据（可配置位置）：
 *    {userDataDir}/
 *      ├── databases/     聊天记录 SQLite 文件（{uuid}.db）
 *      ├── vector/        向量数据库（预留）
 *      └── media/         媒体文件（预留）
 */
export interface PathProvider {
  /** 系统数据根目录（固定 ~/.chatlab/） */
  getSystemDir(): string

  /** 用户数据根目录（可配置） */
  getUserDataDir(): string

  /** 数据库文件目录（存放 {uuid}.db），基于 userDataDir */
  getDatabaseDir(): string

  /** 向量库目录（存放 embedding_index.db 等可再生派生索引），基于 userDataDir */
  getVectorDir(): string

  /** AI 数据目录（对话历史、LLM 配置），基于 systemDir */
  getAiDataDir(): string

  /** 设置目录，基于 systemDir */
  getSettingsDir(): string

  /** 缓存目录（存放可再生的派生数据），基于 systemDir */
  getCacheDir(): string

  /** 临时文件目录，基于 systemDir */
  getTempDir(): string

  /** 日志目录，基于 systemDir */
  getLogsDir(): string

  /** 下载目录（导出文件的默认保存位置） */
  getDownloadsDir(): string
}
