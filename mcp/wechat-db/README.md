# ChatLab MCP — 微信 4.x 数据库直连工具

通过 [MCP（Model Context Protocol）](https://modelcontextprotocol.io/) 让 Claude 直接查询 macOS 微信 4.x 加密数据库，无需手动导出聊天记录。

## 功能

| 工具 | 说明 |
|------|------|
| `wechat_set_key` | 设置数据库解密密钥（一次设置，本次会话生效） |
| `wechat_list_accounts` | 列出本机所有微信账户 |
| `wechat_list_sessions` | 列出最近的聊天会话 |
| `wechat_list_contacts` | 搜索/列出联系人 |
| `wechat_query_messages` | 按联系人/关键词/时间段查询消息 |
| `wechat_get_db_schema` | 查看数据库表结构（便于写自定义 SQL） |
| `wechat_execute_sql` | 执行自定义 SELECT 查询 |

## 前提条件

- macOS 系统，已安装微信 4.x
- 已获取数据库解密密钥（见下方获取方式）
- Node.js >= 20

## 安装

```bash
cd mcp/wechat-db
npm install
npm run build
```

## 获取微信数据库解密密钥

微信 4.x 的数据库使用 SQLCipher 加密（WCDB）。**密钥需要在微信运行时从进程内存中读取。**

### 方式一：使用 PyWxDump（推荐）

[PyWxDump](https://github.com/xaoyaoo/PyWxDump) 是一个开源工具，支持自动读取微信密钥：

```bash
pip install pywxdump
pywxdump show -m
```

会输出类似：

```
key: 0a1b2c3d4e5f6071...（64位十六进制）
```

### 方式二：使用 LLDB 手动读取

1. 在终端运行微信：

```bash
lldb -p $(pgrep WeChat)
```

2. 在 LLDB 中搜索密钥：

```
(lldb) process interrupt
(lldb) memory find -s "your_wxid" -- 0x0 0x7fffffffffff
```

> **注意：** 密钥读取只能在微信运行时进行。请确保在操作前已登录微信。

## 配置

### Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "wechat-db": {
      "command": "node",
      "args": ["/path/to/ChatLab/mcp/wechat-db/dist/index.js"],
      "env": {
        "WECHAT_KEY": "hex:0a1b2c3d4e5f..."
      }
    }
  }
}
```

如果不想在配置文件中明文存储密钥，可以省略 `WECHAT_KEY`，在对话中使用 `wechat_set_key` 工具动态设置。

### Claude Code（CLI）

```bash
claude mcp add wechat-db -- node /path/to/ChatLab/mcp/wechat-db/dist/index.js
```

然后在对话中通过 `wechat_set_key` 设置密钥，或者：

```bash
WECHAT_KEY="hex:0a1b2c..." claude
```

## 使用示例

### 1. 设置密钥并查看账户

```
用户：帮我查看微信里和张三的聊天记录

Claude 调用：
1. wechat_set_key(key="hex:0a1b2c...")
2. wechat_list_accounts()
3. wechat_list_contacts(wxid_or_path="wxid_xxx", search="张三")
4. wechat_query_messages(wxid_or_path="wxid_xxx", talker="zhangsan_wxid", limit=50)
```

### 2. 搜索关键词

```
wechat_query_messages(
  wxid_or_path="wxid_xxx",
  keyword="项目进度",
  start_time=1700000000,
  end_time=1702000000
)
```

### 3. 自定义统计查询

```
wechat_get_db_schema(wxid_or_path="wxid_xxx", db_type="message", shard=0)

wechat_execute_sql(
  wxid_or_path="wxid_xxx",
  db_type="message",
  shard=0,
  sql="SELECT talker, COUNT(*) as cnt FROM WCDBMessage GROUP BY talker ORDER BY cnt DESC LIMIT 20"
)
```

## 数据库结构

### 路径

```
~/Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/
com.tencent.xinWeChat/2.0b4.0.9/
└── {wxid}/
    ├── WCDB_Contact.sqlite    # 联系人数据库
    └── Message/
        ├── msg_0.db           # 消息分片 0
        ├── msg_1.db           # 消息分片 1
        ├── ...
        └── msg_9.db           # 消息分片 9
```

### SQLCipher 参数（微信默认值）

| 参数 | 默认值 |
|------|--------|
| `cipher_page_size` | 4096 |
| `kdf_iter` | 64000 |
| `cipher_hmac_algorithm` | HMAC_SHA1 |
| `cipher_kdf_algorithm` | PBKDF2_HMAC_SHA1 |

如果密钥正确但仍无法打开，可以尝试通过 `wechat_set_key` 的参数调整这些值。

### 主要表结构

**联系人（WCDB_Contact.sqlite → WCDBFriend）**

| 字段 | 说明 |
|------|------|
| `userName` | wxid（主键） |
| `nickName` | 微信昵称 |
| `remarkName` | 你给对方设置的备注 |
| `alias` | 微信号（手动设置的短名） |
| `type` | 类型（1=朋友，2=群，等）|

**消息（msg_N.db → WCDBMessage）**

| 字段 | 说明 |
|------|------|
| `localId` | 本地消息 ID |
| `msgSvrId` | 服务端消息 ID |
| `type` | 消息类型（1=文本，3=图片，34=语音，43=视频…）|
| `isSender` | 1=自己发送，0=对方发送 |
| `talker` | 聊天对象 wxid 或群 ID |
| `content` | 消息内容 |
| `createTime` | 发送时间（Unix 时间戳，秒）|

## 隐私说明

- 本工具以**只读模式**打开数据库，不会修改任何数据
- 密钥仅保存在内存中，进程退出后自动清除
- 建议不要将密钥写入配置文件，使用 `wechat_set_key` 工具动态提供

## 常见问题

**Q: 打开数据库报错 "file is not a database"**

密钥可能不正确，或者 SQLCipher 参数与实际不匹配。微信不同版本可能使用不同参数，可以尝试：
- 确认密钥格式（hex vs 原始密码）
- 调整 `page_size` 为 1024 或 2048

**Q: 找不到联系人数据库**

确认微信账户路径是否正确，使用 `wechat_list_accounts` 查看可用账户。

**Q: 消息分片里找不到某段对话**

消息按 wxid hash 分片存储，同一个联系人的消息固定在某个分片里。建议不指定 `shard` 参数让工具自动查询所有分片。
