---
outline: deep
---

# Docker 部署

ChatLab CLI 提供 `linux/amd64` 和 `linux/arm64` 两种架构的容器镜像：

```text
ghcr.io/chatlab/chatlab-cli
```

## 快速开始

```bash
docker run --name chatlab \
  -p 127.0.0.1:3110:3110 \
  -v chatlab-data:/home/node/.chatlab \
  ghcr.io/chatlab/chatlab-cli:latest
```

容器启动后，打开 <http://127.0.0.1:3110/>。

镜像使用非特权 `node` 用户运行。该数据卷会保留 `/home/node/.chatlab` 下的系统状态和用户数据。替换或升级容器时，请保留该数据卷。

## 服务选项

容器的默认命令是：

```bash
chatlab start --no-open --host 0.0.0.0
```

`chatlab start` 按 CLI 中的声明顺序支持以下选项：

| 选项 | 说明 |
| --- | --- |
| `--port <port>` | 服务端口，默认为 `3110`。 |
| `--host <host>` | 监听地址；在容器外运行时默认为 `127.0.0.1`。 |
| `--token <token>` | 自定义 Bearer Token；省略时由 ChatLab 读取或生成。 |
| `--headless` | 仅启动 API，不提供 Web UI。 |
| `--require-auth` | 除 API 路由外，也要求 Web UI 路由使用 Bearer 认证。 |
| `--no-open` | 不打开浏览器。 |
| `--daemon` | 安装 macOS/Linux 常驻服务，不适用于容器。 |

Docker 参数会替换完整的默认命令。添加服务选项时，需要按需重复 `start`、`--no-open` 和 `--host 0.0.0.0`：

```bash
docker run --rm \
  -p 8080:8080 \
  -v chatlab-data:/home/node/.chatlab \
  ghcr.io/chatlab/chatlab-cli:latest \
  start --port 8080 --host 0.0.0.0 --headless --no-open
```

也可以直接选择其他 CLI 命令：

```bash
docker run --rm ghcr.io/chatlab/chatlab-cli:latest --version
docker run --rm ghcr.io/chatlab/chatlab-cli:latest formats
docker run --rm -v chatlab-data:/home/node/.chatlab \
  ghcr.io/chatlab/chatlab-cli:latest sessions --format json
```

## 环境变量

对于配置字段，ChatLab 按以下优先级读取值：

1. `CHATLAB_*` 环境变量
2. `~/.chatlab/config.toml` 或 `~/.chatlab/config.json`
3. 内置默认值

配置环境变量按源码中的声明顺序如下：

| 环境变量 | 说明 |
| --- | --- |
| `CHATLAB_DATA_DIR` | 覆盖 ChatLab 用户数据目录。设置后，请另外挂载所选目录。 |
| `CHATLAB_API_PORT` | 设置 `api.port`。`start` 命令会提供自身的默认值，因此请使用 `--port` 配置容器服务。 |
| `CHATLAB_API_HOST` | 设置 `api.host`。`start` 命令会提供自身的默认值，因此请使用 `--host` 配置容器服务。 |
| `CHATLAB_LLM_PROVIDER` | 设置 `llm.provider`。 |
| `CHATLAB_LLM_MODEL` | 设置 `llm.model`。 |
| `CHATLAB_LLM_BASE_URL` | 设置 `llm.base_url`。 |
| `CHATLAB_LOCALE_LANG` | 设置 `locale.lang`。 |
| `CHATLAB_CLI_ALLOW_RAW` | 设置为 `1` 或 `true`，允许查询命令输出未经隐私预处理的 `--raw` 结果。 |

ChatLab 还会读取以下运行时变量：

| 环境变量 | 说明 |
| --- | --- |
| `CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR` | 设置为 `1` 可绕过数据目录的最低运行时版本检查。此操作可能损坏数据，仅用于紧急恢复。 |
| `CHATLAB_DISABLE_NATIVE_PERF` | 设置为 `1` 可禁用原生解析器加速。 |
| `CHATLAB_LOG_LEVEL` | 将应用日志级别设置为 `DEBUG`、`INFO`、`WARN` 或 `ERROR`，默认为 `INFO`。 |
| `CHATLAB_SKIP_UPDATE_CHECK` | 设置为任意非空值可禁用 CLI 更新检查。 |
| `CHATLAB_TEMP_ROOT` | 覆盖临时工作区根目录。 |
| `LANG` | 选择 CLI 查询预处理使用的默认语言。 |

Bearer Token、无界面模式、Web UI 认证和浏览器打开行为通过对应的命令行选项配置。ChatLab 不为这些选项提供环境变量别名。

## Docker Compose

```yaml
services:
  chatlab:
    image: ghcr.io/chatlab/chatlab-cli:latest
    restart: unless-stopped
    ports:
      - "3110:3110"
    volumes:
      - chatlab-data:/home/node/.chatlab
    command:
      - start
      - --port
      - "3110"
      - --host
      - 0.0.0.0
      - --token
      - ${CHATLAB_TOKEN:?set CHATLAB_TOKEN in the Compose environment}
      - --require-auth
      - --no-open

volumes:
  chatlab-data:
```

`CHATLAB_TOKEN` 由 Docker Compose 插值后作为 `--token` 的值传给 ChatLab，并不是 ChatLab 环境变量。请将其保存在密钥存储或未跟踪的 `.env` 文件中。

## 多架构镜像

Docker 会自动选择与宿主机架构匹配的镜像。也可以显式选择平台：

```bash
docker pull --platform linux/amd64 ghcr.io/chatlab/chatlab-cli:latest
docker pull --platform linux/arm64 ghcr.io/chatlab/chatlab-cli:latest
```

镜像索引还包含来源证明。镜像仓库界面可能将这些元数据清单显示为 `unknown/unknown`；它们不是可运行平台，也无需单独拉取。
