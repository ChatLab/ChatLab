---
outline: deep
---

# 使用 AI 转换聊天记录

如果 ChatLab 还不能直接识别你的聊天记录，可以让本机 Agent 使用官方转换 Skill 分析文件结构、编写转换脚本，并将记录转换成 [ChatLab 标准格式](./chatlab-format.md)。

转换过程在本机执行，Skill 会限制 Agent 只读取必要的结构信息，不在终端中打印完整聊天正文。源文件始终保持不变。

## 准备工具

先安装 ChatLab CLI：

```bash
npm install -g chatlab-cli
```

再在支持 Skills 的 Agent 环境中安装中文版转换 Skill：

```bash
npx skills add ChatLab/ChatLab --skill chatlab-convert-cn -g
```

## 开始转换

把聊天导出的准确路径告诉 Agent：

```text
使用 $chatlab-convert-cn，把 "/你的/聊天记录路径" 转换并导入 ChatLab。
```

如果只希望生成转换结果，不立即导入：

```text
使用 $chatlab-convert-cn，把 "/你的/聊天记录路径" 转换为 ChatLab 格式，只转换，不导入。
```

Skill 会自动选择电脑上已有的 Node.js、Python 或 Shell 工具，完成以下流程：

1. 先确认 ChatLab 是否已经支持该格式；
2. 只提取字段、类型、数量等必要结构，避免输出聊天正文；
3. 确认成员、时间、会话边界和消息类型的映射；
4. 编写并运行可重复使用的本地转换脚本；
5. 默认生成适合大文件流式处理的 JSONL；
6. 严格校验格式和记录数量，再执行 ChatLab 导入预览；
7. 只有你明确要求导入时，才会正式写入 ChatLab。

如果一个源文件包含多个会话，Skill 会分别生成多个文件，不会把它们误合并。

## 如何判断转换成功

转换完成前，Agent 必须依次执行：

```bash
chatlab validate "/转换后的文件.jsonl" --json
chatlab import "/转换后的文件.jsonl" --dry-run --json
```

只有严格验证和导入预览都成功，并且源消息数与输出消息数核对一致，才会报告转换成功。转换脚本和输出文件都会保留，方便以后重新转换更新后的聊天记录。

::: warning 隐私提醒
请使用能够访问本机文件和终端的 Agent 执行转换，不要把完整聊天文件上传到在线对话框。即使需要排查特殊文本格式，也应只检查最小范围并隐藏消息正文。
:::
