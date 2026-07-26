# Web AI SDK Spike

隔离验证 AI SDK 在 ChatLab Web WASM 技术栈中的浏览器可行性，不接入正式产品路由。

## 验证内容

- `@ai-sdk/openai-compatible` 和 `@ai-sdk/deepseek` 可以被 Vite 浏览器构建。
- 浏览器直连 Provider 的流式输出与 CORS。
- `ToolLoopAgent` 的多步工具调用。
- `AbortSignal` 中止与 `onAbort` 收口。
- 相对空白入口的构建体积增量。

## 运行

```bash
pnpm run dev:web-ai-spike
pnpm run build:web-ai-spike
```

打开 `http://127.0.0.1:3131/`，在 password 输入框临时输入测试 Key。页面不使用 localStorage、IndexedDB、Cookie 或 URL 保存 Key，刷新即清空。

不要把真实 Key 写入源码、环境文件、测试 fixture、截图或提交记录。

## 2026-07-26 验证结论

环境：AI SDK `7.0.37`、`@ai-sdk/deepseek` `3.0.13`、`@ai-sdk/openai-compatible` `3.0.14`、DeepSeek `deepseek-v4-flash`，由 `http://127.0.0.1:3131` 的真实浏览器页面直接请求 `https://api.deepseek.com`。

| 验证项 | 结果 |
| --- | --- |
| 浏览器 CORS | 通过；携带 Bearer Token 的真实流式请求可从本地 origin 直连 DeepSeek，不需要 ChatLab 服务端代理 |
| OpenAI-Compatible 流式 | 通过；reasoning delta 与 text delta 均可消费，样本首输出 593 ms |
| OpenAI-Compatible 工具循环 | 通过；`get_chat_overview` 调用 1 次，工具结果自动回填并生成第二轮总结，样本首输出 511 ms |
| DeepSeek 官方 Provider 流式 | 通过；reasoning delta 与 text delta 均可消费，样本首输出 658 ms |
| DeepSeek 官方 Provider 工具循环 | 通过；`get_chat_overview` 调用 1 次并完成第二轮总结，样本首输出 580 ms |
| AbortSignal | 通过；流式生成中途停止，收到 abort 事件并收口为正常的“已中止”状态 |
| Key 生命周期 | 通过；仅存在 password 输入框和 JS 内存，页面刷新后为空，不使用浏览器持久化 |

时间与 Token 数据只是单次网络样本，不作为性能承诺。

AI SDK 7 在主动取消底层 `fetch` 时，Chromium DevTools 仍会记录一条 `AbortError`，即使业务代码已经消费异常并正确进入 `onAbort`。这不影响 UI 状态或继续请求，但正式 Runtime 的日志上报必须把预期取消从错误事件中排除。

### Provider 兼容差异

DeepSeek V4 默认思考模式不接受强制指定工具的 `tool_choice`，会返回 `Thinking mode does not support this tool_choice`。改用标准 `auto` 工具选择后，OpenAI-Compatible 和 DeepSeek 官方 Provider 都能完成工具循环。

共享 Runtime 因此不能假设所有 OpenAI-Compatible Provider 都支持 `required` 或指定工具；Provider capability 应显式声明，默认使用 `auto`。

### 构建体积

Vite 生产构建结果：

- 空白基线入口：`0.10 kB` gzip。
- Spike 主入口（AI SDK Agent 核心与测试页逻辑）：约 `94.02 kB` gzip。
- DeepSeek Provider 动态 chunk：约 `3.76 kB` gzip。
- OpenAI-Compatible Provider 动态 chunk：约 `7.02 kB` gzip。
- 测试页 CSS：约 `0.96 kB` gzip。

Provider 使用动态导入，运行时只下载用户实际选择的一种。正式接入时 AI Tab 也必须整体懒加载，避免增加 Web WASM 首页首屏体积。
