---
outline: deep
---

# Docker 部署

ChatLab CLI 提供 `linux/amd64` 和 `linux/arm64` 两种架构的容器镜像：

```text
ghcr.io/chatlab/chatlab-cli
```

## 快速开始

### 与 Desktop / 本地 CLI 共用数据（推荐）

ChatLab 的 Desktop、CLI 和 Docker 都可以使用宿主机的 `~/.chatlab`。本机运行 Docker 时，建议直接挂载这个目录：

macOS / Linux：

```bash
mkdir -p "$HOME/.chatlab" "$HOME/Downloads"

docker run --name chatlab \
  -p 127.0.0.1:3110:3110 \
  --user "$(id -u):$(id -g)" \
  --mount type=bind,source="$HOME/.chatlab",target=/home/node/.chatlab \
  --mount type=bind,source="$HOME/Downloads",target=/home/node/Downloads \
  -e HOME=/home/node \
  -e CHATLAB_DATA_DIR=/home/node/.chatlab/data \
  ghcr.io/chatlab/chatlab-cli:latest
```

Windows PowerShell：

```powershell
New-Item -ItemType Directory -Force "$HOME/.chatlab" | Out-Null

docker run --name chatlab `
  -p 127.0.0.1:3110:3110 `
  --mount "type=bind,source=$HOME/.chatlab,target=/home/node/.chatlab" `
  -e CHATLAB_DATA_DIR=/home/node/.chatlab/data `
  ghcr.io/chatlab/chatlab-cli:latest
```

容器启动后，打开 <http://127.0.0.1:3110/>。

镜像默认使用非特权 `node` 用户（UID/GID 1000）运行。在 macOS 和 Linux 上，`--user` 会让容器进程使用宿主机当前用户的 UID/GID，`HOME` 则确保 ChatLab 的系统目录仍是 `/home/node/.chatlab`。对于当前用户 UID/GID 不是 1000 的 Linux 主机，这两个参数是必需的。宿主机的 `~/.chatlab` 对应容器内的 `/home/node/.chatlab`，`~/Downloads` 对应容器内可写的下载目录；`CHATLAB_DATA_DIR` 将默认用户数据固定到容器可访问的 `/home/node/.chatlab/data`，避免宿主机 `config.toml` 中的绝对路径在容器内失效。

使用这组命令后，两种切换都不需要复制数据：

- 先使用 Docker，之后安装 Desktop 或本地 CLI：Desktop / CLI 会继续读取宿主机 `~/.chatlab`。
- 已经使用 Desktop 或本地 CLI，之后启动 Docker：Docker 会直接读取原有的配置、聊天数据库和 AI 数据。

### 使用独立 Docker 数据

在服务器上部署，或者明确不想与宿主机上的 ChatLab 共用数据时，可以使用 Docker named volume：

```bash
docker run --name chatlab \
  -p 127.0.0.1:3110:3110 \
  -v chatlab-data:/home/node/.chatlab \
  ghcr.io/chatlab/chatlab-cli:latest
```

该数据卷会保留容器内的系统状态和用户数据，但 Desktop 和宿主机 CLI **不会**自动看到其中的数据。替换或升级容器时，请保留 `chatlab-data` 数据卷。

### 自定义用户数据目录

如果 Desktop / CLI 已将聊天数据库移动到 `~/.chatlab` 之外，还需要挂载该目录，并让环境变量指向对应的容器路径：

```bash
docker run --name chatlab \
  -p 127.0.0.1:3110:3110 \
  --user "$(id -u):$(id -g)" \
  --mount type=bind,source="$HOME/.chatlab",target=/home/node/.chatlab \
  --mount type=bind,source="$HOME/Downloads",target=/home/node/Downloads \
  --mount type=bind,source="/absolute/path/to/chatlab-data",target=/chatlab-data \
  -e HOME=/home/node \
  -e CHATLAB_DATA_DIR=/chatlab-data \
  ghcr.io/chatlab/chatlab-cli:latest
```

请将 `/absolute/path/to/chatlab-data` 替换为宿主机上的真实用户数据目录。系统数据仍通过 `~/.chatlab` 挂载。由于 `CHATLAB_DATA_DIR` 的优先级最高，Docker 的数据目录应通过挂载和环境变量调整，而不是在存储管理页面中切换。

同一版本的 Desktop、CLI 和 Docker 可以共享数据库。切换数据目录、执行迁移或跨版本使用前，建议先停止其他 ChatLab 实例；如果旧版本无法安全读取已经升级的数据目录，ChatLab 会通过兼容门禁拒绝启动。

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
  -p 127.0.0.1:8080:8080 \
  --user "$(id -u):$(id -g)" \
  --mount type=bind,source="$HOME/.chatlab",target=/home/node/.chatlab \
  --mount type=bind,source="$HOME/Downloads",target=/home/node/Downloads \
  -e HOME=/home/node \
  -e CHATLAB_DATA_DIR=/home/node/.chatlab/data \
  ghcr.io/chatlab/chatlab-cli:latest \
  start --port 8080 --host 0.0.0.0 --headless --no-open
```

也可以直接选择其他 CLI 命令：

```bash
docker run --rm ghcr.io/chatlab/chatlab-cli:latest --version
docker run --rm ghcr.io/chatlab/chatlab-cli:latest formats
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --mount type=bind,source="$HOME/.chatlab",target=/home/node/.chatlab \
  --mount type=bind,source="$HOME/Downloads",target=/home/node/Downloads \
  -e HOME=/home/node \
  -e CHATLAB_DATA_DIR=/home/node/.chatlab/data \
  ghcr.io/chatlab/chatlab-cli:latest sessions list --format json
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

先在 Compose 文件旁创建未跟踪的 `.env`：

```dotenv
CHATLAB_HOST_DIR=/absolute/path/to/.chatlab
CHATLAB_DOWNLOADS_DIR=/absolute/path/to/Downloads
CHATLAB_UID=1000
CHATLAB_GID=1000
CHATLAB_TOKEN=replace-with-a-secret-token
```

将 `CHATLAB_HOST_DIR` 替换为宿主机的 `~/.chatlab` 绝对路径，并将 `CHATLAB_DOWNLOADS_DIR` 设置为一个已存在且可写的导出和截图目录，例如宿主机的 `~/Downloads`。在 macOS 和 Linux 上，还需要将 `CHATLAB_UID`、`CHATLAB_GID` 分别替换为 `id -u`、`id -g` 的输出；Windows Docker Desktop 可以保留 `1000`。

```yaml
services:
  chatlab:
    image: ghcr.io/chatlab/chatlab-cli:latest
    restart: unless-stopped
    user: "${CHATLAB_UID:-1000}:${CHATLAB_GID:-1000}"
    ports:
      - "127.0.0.1:3110:3110"
    environment:
      HOME: /home/node
      CHATLAB_DATA_DIR: /home/node/.chatlab/data
    volumes:
      - "${CHATLAB_HOST_DIR:?set CHATLAB_HOST_DIR in the Compose environment}:/home/node/.chatlab"
      - "${CHATLAB_DOWNLOADS_DIR:?set CHATLAB_DOWNLOADS_DIR in the Compose environment}:/home/node/Downloads"
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
```

`CHATLAB_TOKEN` 由 Docker Compose 插值后作为 `--token` 的值传给 ChatLab，并不是 ChatLab 环境变量。请将其保存在密钥存储或未跟踪的 `.env` 文件中。如果需要完全独立的服务器数据，请改用上文“使用独立 Docker 数据”中的 named volume。

## 多架构镜像

Docker 会自动选择与宿主机架构匹配的镜像。也可以显式选择平台：

```bash
docker pull --platform linux/amd64 ghcr.io/chatlab/chatlab-cli:latest
docker pull --platform linux/arm64 ghcr.io/chatlab/chatlab-cli:latest
```

镜像索引还包含来源证明。镜像仓库界面可能将这些元数据清单显示为 `unknown/unknown`；它们不是可运行平台，也无需单独拉取。
