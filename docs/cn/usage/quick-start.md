---
outline: deep
---

# 快速开始

## 第一步：安装 ChatLab

ChatLab 提供两种安装方式：

**方式一：官网下载安装包**

前往 [ChatLab 官网](https://chatlab.fun) 下载对应操作系统的安装包，双击安装即可。也可以从 [GitHub Releases](https://github.com/ChatLab/ChatLab/releases) 下载。

**方式二：CLI 安装**

```bash
npm i chatlab-cli -g
```

需要 Node.js ≥ 20。CLI 适合服务端部署或搭配 AI Agent（如 Claude Desktop）使用。

安装后运行以下命令启动 ChatLab：

```bash
chatlab start           # 启动 API + Web UI，并在浏览器中打开
chatlab start --no-open # 启动 API + Web UI，但不自动打开浏览器
chatlab start --headless  # 仅启动 API，不挂载 Web UI（供脚本 / AI Agent 调用）
```

常用选项：`--port <端口>`（默认 3110）、`--host <地址>`、`--token <令牌>`。

如果希望服务常驻后台（开机自启 + 崩溃自动重启），加上 `--daemon` 参数：

```bash
chatlab start --daemon   # 注册为系统服务，开机自启（macOS / Linux）
chatlab status           # 查看常驻状态
chatlab stop             # 停止并取消常驻
```

## 第二步：导入聊天记录

ChatLab 提供三种导入方式，适用于不同场景：

| 方式 | 适用场景 |
|------|----------|
| **文件导入** | 将导出的聊天记录文件直接拖入 ChatLab 首页，适合一次性导入 |
| **自动同步** | 配置外部平台的数据源，让聊天记录定期自动同步到 ChatLab |
| **API 导入** | 开启本地 API 服务，允许第三方工具/插件或脚本主动推送聊天记录至 ChatLab |

### 普通用户

使用**文件导入**即可，你需要：

1. 先使用第三方工具将聊天记录导出为文件，具体导出方式请查看 [导出聊天记录](/cn/usage/how-to-export)。
2. 将导出的文件直接拖入 ChatLab 首页即可，如遇问题请查看 [导入聊天记录指南](/cn/usage/how-to-import)。

### 开发者

如果你是开发者，想要对接**自动同步**或 **API 导入**，请查看以下文档：

- [Push 导入协议](/cn/standard/chatlab-import) — 对应「API 导入」
- [Pull 远程数据源协议](/cn/standard/chatlab-pull) — 对应「自动同步」
- [ChatLab Format](/cn/standard/chatlab-format) — 了解数据格式规范

## 第三步：配置 AI

ChatLab 内置 AI Agent 功能，接入 AI 模型后即可通过自然语言探索你的聊天历史。

详细配置步骤请查看 [如何配置 AI 模型](/cn/usage/how-to-config-ai)。
