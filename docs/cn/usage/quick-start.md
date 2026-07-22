---
outline: deep
---

# 快速开始

尚未安装时，请先查看 [安装 ChatLab](/cn/usage/installation) 或 [Docker 部署](/cn/usage/docker)。

## 第一步：导入聊天记录

ChatLab 提供三种导入方式，适用于不同场景：

| 方式 | 适用场景 |
|------|----------|
| **文件导入** | 将导出的聊天记录文件直接拖入 ChatLab 首页，适合一次性导入 |
| **自动同步** | 配置外部平台的数据源，让聊天记录定期自动同步到 ChatLab |
| **API 推送** | 开启本地 API 服务，允许第三方工具/插件或脚本主动推送聊天记录至 ChatLab |

### 普通用户

使用**文件导入**即可，你需要：

1. 先使用第三方工具将聊天记录导出为文件，具体导出方式请查看 [导出聊天记录](/cn/usage/how-to-export)。
2. 将导出的文件直接拖入 ChatLab 首页即可，如遇问题请查看 [导入聊天记录指南](/cn/usage/how-to-import)。

### 开发者

如果你是开发者，想要对接**自动同步**或 **API 推送**，请查看以下文档：

- [Push 导入协议](/cn/standard/chatlab-import) — 对应「API 推送」
- [Pull 远程数据源协议](/cn/standard/chatlab-pull) — 对应「自动同步」
- [ChatLab Format](/cn/standard/chatlab-format) — 了解数据格式规范

## 第二步：配置 AI

ChatLab 内置 AI Agent 功能，接入 AI 模型后即可通过自然语言探索你的聊天历史。

进一步了解 ChatLab 如何使用 AI 分析聊天记录，请查看 [为什么选择 ChatLab](/cn/ai/why-chatlab)。
