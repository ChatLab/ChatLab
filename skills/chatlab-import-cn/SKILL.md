---
name: chatlab-import-cn
description: 通过 clb 预览并导入本地聊天导出文件，支持重新导入和增量更新。用于导入请求，不用于只读分析或未知格式转换。
---

# ChatLab 聊天导入

通过 `clb` CLI 导入本地聊天导出文件。始终先预览准确的写入计划。将用户明确提出的导入请求视为授权，预览成功后继续执行，不再请求二次确认。

分析已有记录时，可用则使用 `chatlab-analyze-cn`；源格式不受支持时，可用则使用 `chatlab-convert-cn`。受支持格式的导入不依赖这两个技能。

## 工作流程

1. 检查 CLI，并确认唯一、准确的文件路径：

```bash
clb --help
```

如果 CLI 未安装，告诉用户运行 `npm install -g chatlab-cli`。未经批准不要自行安装软件。复用用户指定的文件和目标，路径仍有歧义时才询问。每条命令中的路径都要加引号。

2. 只读预览导入计划：

```bash
clb import "/absolute/path/to/chat-export.json" --dry-run --json
```

如果用户选择了已有会话，在预览和正式导入中都加入 `--session-id <session-id>`。

3. 只总结新建或更新模式、目标会话 ID、扫描消息数、新增消息数、重复消息数，以及匹配方式或新建原因。不要引用消息正文。

4. 确认 `ok: true`，从 `data` 读取计划后决定：

- 用户只要求预览或检查时，到此停止，不写入数据。
- `importMode` 为 `incremental` 且 `newMessageCount` 为 `0` 时，告诉用户会话已经是最新状态，然后停止。
- `importMode` 为 `incremental` 且存在新增消息时，无需再次确认，自动继续。
- `importMode` 为 `created` 时，自动继续。如果 `createReason` 为 `ambiguous`，通过新建会话保护已有会话，并在最终结果中说明原因。
- 结果不足以确定安全操作时，停止并说明缺少的信息。

5. 根据上一步可以写入时，使用相同文件、目标和格式移除 `--dry-run`：

```bash
clb import "/absolute/path/to/chat-export.json" --json
```

根据最终 JSON 信封报告结果会话 ID、导入模式、新增消息数和重复消息数。

## 安全边界

- 绝不跳过预览、直接编辑 ChatLab 数据库、删除或合并会话。
- 绝不泄露完整聊天导出文件或消息正文。
- 绝不编造文件路径、解析格式或会话 ID。
- 仅在修正方式明确时遵循 `error.hint`。
- `FILE_NOT_FOUND`、`INVALID_SESSION_ID` 优先从上下文修正，无法确定时询问；`UNRECOGNIZED_FORMAT` 查看 `clb formats`；`IMPORT_IN_PROGRESS` 在现有导入完成后重试一次，仍阻塞则报告，不无限轮询。
- 优先使用用户当前使用的中文变体回答，命令、参数、JSON 字段和错误码保持原样。
