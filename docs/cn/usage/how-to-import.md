---
outline: deep
---

# 导入聊天记录指南

ChatLab 支持多种方式导入聊天记录。

## 桌面端：在首页拖入文件

这是最简单的导入方式：

1. 将聊天平台导出的**数据文件**拖入首页上传区域。
2. 等待解析和导入完成。

首页同时支持增量导入，如果新文件与已导入会话能匹配，ChatLab 会增量补充新的消息。

## Agent：使用 AI Skill 导入

适合已经使用 Codex、Claude Code 等各类 AI Agent，希望让 Agent 代为执行导入的用户。

需要 Node.js 20 或更高版本。安装 ChatLab CLI 和中文 Skill：

```bash
npm install -g chatlab-cli
npx skills add ChatLab/ChatLab --skill chatlab-import-cn -g
```

然后直接告诉 Agent：

```text
chatlab-import-cn 帮我把 /absolute/path/to/chat-export.json 导入 ChatLab
```

Agent 会先在后台预览，预览成功后自动新建或增量导入，无需再次确认。

## 终端：使用命令行导入

安装 ChatLab CLI：

```bash
npm install -g chatlab-cli
```

最简单的用法是直接导入一个文件：

```bash
chatlab import "/absolute/path/to/chat-export.json"
```

### 指定已有会话

需要明确追加到某个会话时，使用 `--session-id`：

```bash
chatlab import "/absolute/path/to/chat-export.json" --session-id <session-id>
```

## 自动化：使用 API 或自动同步

这是适合长期集成的进阶方式。首页的「API 导入」提供两个方向：

- **自动同步（Pull）**：ChatLab 定时从已配置的数据源拉取新增聊天记录，详见 [Pull 远程数据源协议](/cn/standard/chatlab-pull)。
- **API 推送（Push）**：第三方工具、插件或脚本通过 ChatLab 本地 API 主动写入聊天记录，详见 [Push 导入协议](/cn/standard/chatlab-import)。

## 导入失败怎么办

在 ChatLab 左下角打开「设置」→「存储管理」→「日志文件」，然后查看其中的 `import` 目录。

命令行模式还可以根据 JSON 中的 `error.code` 和 `error.hint` 排查文件路径、格式、并发导入或会话 ID 问题。如果仍无法解决，可以携带脱敏后的错误信息提交 GitHub Issue。
