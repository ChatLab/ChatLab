---
layout: doc
title: ChatLab 文档 | 开源聊天记录分析工具
---

# ChatLab

ChatLab 是一款免费、开源、本地优先的聊天记录分析工具，支持从 WhatsApp、QQ、LINE、Discord、Instagram、Telegram、iMessage 导入聊天记录，提供可视化统计分析与 AI 智能对话功能，所有数据本地存储、不上传云端。

## 如何使用 ChatLab

- [ChatLab 介绍](/cn/intro) — 了解 ChatLab 是什么，以及它的核心功能。
- [快速开始](/cn/usage/quick-start) — 安装 ChatLab 并完成第一次聊天记录导入的步骤指南。
- [导出与导入](/cn/usage/how-to-export) — 从 WhatsApp、QQ、LINE 等平台导出聊天记录并导入 ChatLab 分析。
- [使用内置 AI 分析](/cn/ai/chatlab-ai) — 接入 OpenAI、Claude、DeepSeek 等 AI 模型，用自然语言分析聊天内容。
- [故障排查](/cn/usage/troubleshooting) — 解决导入失败、格式不支持、AI 配置报错等常见问题。

## 开发者：对接 ChatLab

- [标准与 API](/cn/standard/chatlab-api) — ChatLab 本地 REST API 文档，支持外部工具查询、导入和分析聊天数据。
- [ChatLab Format](/cn/standard/chatlab-format) — 聊天数据交换格式规范，用于跨平台数据互通。
- [Push 导入协议](/cn/standard/chatlab-import) — 通过 HTTP 接口将外部聊天数据推送导入 ChatLab。
- [Pull 远程数据源协议](/cn/standard/chatlab-pull) — 暴露标准 HTTP 端点，让 ChatLab 主动拉取远程聊天数据。
- [AI 辅助转换指南](/cn/standard/ai-converter) — 使用 AI 将不支持的聊天记录格式转换为 ChatLab 标准格式。

## 参与贡献

- [开发指南](/cn/contributing/development) — ChatLab 本地开发环境搭建、仓库结构、架构边界和 PR 规范。

## 更多

- [官网与路线图](https://chatlab.fun/cn/) — 前往官网下载 ChatLab 桌面端或 CLI，查看产品路线图和社区入口。
