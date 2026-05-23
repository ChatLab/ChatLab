# 导出聊天记录

ChatLab 专注于对已导出数据的分析，我们不提供抓取数据的功能。

您需要先使用官方或开源社区的第三方工具，将聊天记录导出后，再导入 ChatLab 进行分析。

## 微信

目前 **WeFlow** 已适配 ChatLab 的导出协议，属于**非官方导出工具**。使用前请自行甄别项目安全性。

- **项目地址**：[https://github.com/hicccc77/WeFlow](https://github.com/hicccc77/WeFlow)
- **支持平台**：Windows / macOS / Linux
- **使用教程**：参考项目 README。

如果你已通过其他方式导出，你可以参考 [标准化格式规范](/cn/standard/chatlab-format)，将格式转为 ChatLab 标准格式，即可导入分析。

## QQ

目前有两种方式：

### QQ Chat Exporter

目前已适配 **QQ Chat Exporter** 导出的 json / jsonl 格式。

- **项目地址**：[https://github.com/shuakami/qq-chat-exporter](https://github.com/shuakami/qq-chat-exporter)
- **支持平台**：Windows / Linux
- **使用教程**：参考项目 README。
- **提示**：导出时，需要选择格式为 json，同时建议勾选 「嵌入头像为 Base64」选项后再导出。
- **提示 2**：对于导出的 jsonl 格式，仅需导入 jsonl 格式目录中的 manifest.json 文件

### 旧版 QQ（消息管理器）

ChatLab 支持**旧版 QQ 原生导出的 txt 格式**（通过 QQ 消息管理器导出），直接将 `.txt` 文件拖入即可。

## 抖音

目前 **douyin-chat-export** 已适配 ChatLab 的导出协议，属于**非官方导出工具**，使用前请自行甄别项目安全性。

- **项目地址**：[https://github.com/TeamBreakerr/douyin-chat-export](https://github.com/TeamBreakerr/douyin-chat-export)
- **支持平台**：Windows / macOS / Linux
- **使用教程**：参考项目 README。

## 飞书

目前 **xiaofeixia** 已适配 ChatLab 的导出协议，属于**非官方导出工具**，使用前请自行甄别项目安全性。

- **项目地址**：[https://github.com/JiQingzhe2004/xiaofeixia](https://github.com/JiQingzhe2004/xiaofeixia)
- **支持平台**：Windows / macOS
- **使用教程**：参考项目 README。

注意事项：使用该软件需向企业管理员申请权限，因此不适用于个人员工。

## 企微

企微官方接口提供了导出聊天记录的功能，但是需要通过第三方SCRM系统进行导出。

如果你是管理员，需要自行采购支持导出的第三方SCRM系统，然后才能导出并分析。

个人用户暂时没有任何方式可以导出聊天记录。

## WhatsApp

对于 WhatsApp， 目前已适配官方提供的"导出聊天"功能。

目前已兼容中文语言和英文语言的导出，如有其他语言需求，请联系开发者。

- **导出方式**：
  1. 打开 WhatsApp，进入想要导出的对话。
  2. 点击顶部联系人名称 -> 导出聊天 (Export Chat)。
  3. 选择"不附加媒体"。
- **格式**：将导出后的 `.zip` 包解压出其中的 `txt` 文件，将 `txt` 文件拖入 ChatLab 即可。

## Discord

对于 Discord，目前已适配 **DiscordChatExporter** 导出的 json 格式。

- **项目地址**：[https://github.com/Tyrrrz/DiscordChatExporter](https://github.com/Tyrrrz/DiscordChatExporter)
- **支持平台**：Windows / macOS / Linux
- **使用教程**：参考项目 README。
- **提示**：请务必选择导出格式为 **JSON**，以便 ChatLab 正确解析。

## Instagram

对于 Instagram，目前已适配官方提供的导出功能。

- **导出方式**：
  1. 打开 Instagram 应用或网页版，进入「设置」。
  2. 点击「账户中心」->「你的信息和权限」->「下载你的信息」。
  3. 选择「部分信息」，然后勾选「消息」。
  4. 选择格式为 **JSON**，日期范围选择「所有时间」。
  5. 点击「提交请求」，等待 Instagram 处理完成后下载。
- **格式**：将下载的压缩包解压后，找到 `your_instagram_activity/messages/inbox/` 目录下对应聊天的 `message_1.json` 文件，拖入 ChatLab 即可。
- **提示**：如果对话内容较多，可能会有多个 `message_*.json` 文件，建议逐个导入。

## LINE

对于 LINE，目前已适配官方提供的聊天记录导出功能。

- **导出方式**：
  1. 打开 LINE，进入想要导出的对话。
  2. 移动端：点击聊天右上角菜单 -> 设置 -> 导出聊天记录。
  3. 桌面端（Windows / macOS）：进入 Chats，打开对应聊天后，点击右上角菜单 -> Save chat。
  4. 保存或分享导出的文本文件。
- **格式**：将导出的 `.txt` 文件直接拖入 ChatLab 即可。
- **提示**：LINE 官方说明中提到，桌面端仅会保存当前已加载并显示在聊天窗口中的消息。

<!-- Telegram 由于在中文下较为敏感，因此虽然支持了，但是不明面列举导出方式 -->

## iMessage

计划兼容 https://github.com/ReagentX/imessage-exporter 该项目导出的 json 格式

不过目前开发者没有数据样本用来测试，如果您有迫切的需求，欢迎提供脱敏后的数据样本，我会第一时间支持。

## Q&A：小红书/企微/钉钉等的聊天记录能分析吗？

ChatLab 的功能是 **对已导出的固定文本格式的聊天记录进行分析**，但前提是**您已经通过合法合规的渠道导出了聊天记录**。

我们**不提供任何解密、抓包或导出的工具与脚本**，只支持对已导出的聊天记录格式进行兼容。只要您能提供脱敏后的聊天记录文本样本，那么就可以尝试支持分析。

如果您有一定的技术基础，可以尝试使用 **AI 辅助转换** 的方式，将您的数据转换为标准格式。详情请查看 [AI 辅助转换指南](/cn/standard/ai-converter)。

此外，如果您是开发者，并已支持了其他聊天应用的聊天记录导出，欢迎[兼容 ChatLab 格式](/cn/standard/chatlab-format)，我会将您的 Github 链接加到这里。

## ⚠️ 使用说明

在尝试分析聊天数据或使用相关工具前，请务必仔细阅读并知晓以下条款：

- **第三方工具**：**使用第三方导出工具时，请务必仔细阅读其官方文档和安全说明。** ChatLab 与文中所列的第三方项目无任何关联，相关链接仅作为技术信息参考提供，不代表本项目认可、担保或安全性背书。用户需自行评估并承担使用第三方工具的所有风险。
- **合法授权原则**：您仅可处理您**本人参与**的聊天记录。若涉及他人隐私，请务必确保已获得相关人员的知情同意。
- **禁止非法用途**：严禁将本软件用于窃取、监控或分析未经授权的他人隐私，或用于任何侵犯他人权益的行为。
- **合规性自负**：从第三方平台获取数据的行为属于您的个人行为。若因分析行为违反了原始数据来源平台的服务条款而导致账号受限或其他后果，ChatLab 不承担任何责任。
- **禁止商用**：严禁任何个人或机构将本软件或分析结果用于任何形式的商业盈利行为。
- **结果准确性**：软件生成的分析结果可能存在错误或“幻觉”，仅供技术交流参考，不应作为法律证据或决策依据。
