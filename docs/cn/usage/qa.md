# Q&A

## 未来会支持音频、图片导入吗？

不确定，目前的文本分析功能仍然有非常多的 TODO 需要实现，计划文本分析的功能完善之后再考虑音频和图片的分析。

## 如何直接访问本地数据库

ChatLab 使用 SQLite 存储聊天记录，你可以用任何 SQLite 客户端工具直接查看数据。

### 数据库位置

你可直接通过软件的 设置 > 存储管理 > 聊天记录数据库 > 打开，打开数据库所在文件夹。

| 平台    | 路径                                                    |
| ------- | ------------------------------------------------------- |
| macOS   | `~/Library/Application Support/ChatLab/data/databases/` |
| Windows | `%APPDATA%/ChatLab/data/databases/`                     |
| Linux   | `~/.config/ChatLab/data/databases/`                     |

每个聊天记录是一个独立的 `.db` 文件。

### 推荐工具

- [DB Browser for SQLite](https://sqlitebrowser.org/) - 免费开源，新手友好
- [TablePlus](https://tableplus.com/) - 界面美观
- [DBeaver](https://dbeaver.io/) - 功能强大

### 命令行访问

```bash
# macOS/Linux
sqlite3 ~/Library/Application\ Support/ChatLab/data/databases/你的数据库.db

# 常用命令
.tables          # 查看所有表
.schema message  # 查看 message 表结构
SELECT * FROM message LIMIT 10;  # 查询消息
```

### 表结构

- `meta` - 聊天记录元信息
- `member` - 成员信息
- `message` - 消息内容
- `member_name_history` - 成员改名历史

### 注意事项

⚠️ 建议在 ChatLab **关闭时**访问数据库，避免锁冲突。
