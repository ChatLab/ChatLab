---
outline: deep
---

# Docker 部署

ChatLab CLI 提供 `linux/amd64` 與 `linux/arm64` 兩種架構的容器映像：

```text
ghcr.io/chatlab/chatlab-cli
```

## 快速開始

```bash
docker run --name chatlab \
  -p 127.0.0.1:3110:3110 \
  -v chatlab-data:/data \
  ghcr.io/chatlab/chatlab-cli:latest
```

容器啟動後，開啟 <http://127.0.0.1:3110/>。

映像使用非特權 `node` 使用者執行，並將 ChatLab 資料儲存在 `/data`。替換或升級容器時，請保留此資料卷。

## 服務選項

容器的預設命令是：

```bash
chatlab start --no-open --host 0.0.0.0
```

`chatlab start` 按照 CLI 中的宣告順序支援以下選項：

| 選項 | 說明 |
| --- | --- |
| `--port <port>` | 服務連接埠，預設為 `3110`。 |
| `--host <host>` | 監聽位址；在容器外執行時預設為 `127.0.0.1`。 |
| `--token <token>` | 自訂 Bearer Token；省略時由 ChatLab 讀取或產生。 |
| `--headless` | 僅啟動 API，不提供 Web UI。 |
| `--require-auth` | 除 API 路由外，也要求 Web UI 路由使用 Bearer 驗證。 |
| `--no-open` | 不開啟瀏覽器。 |
| `--daemon` | 安裝 macOS/Linux 常駐服務，不適用於容器。 |

Docker 參數會替換完整的預設命令。加入服務選項時，需要視需要重複 `start`、`--no-open` 與 `--host 0.0.0.0`：

```bash
docker run --rm \
  -p 8080:8080 \
  -v chatlab-data:/data \
  ghcr.io/chatlab/chatlab-cli:latest \
  start --port 8080 --host 0.0.0.0 --headless --no-open
```

也可以直接選擇其他 CLI 命令：

```bash
docker run --rm ghcr.io/chatlab/chatlab-cli:latest --version
docker run --rm ghcr.io/chatlab/chatlab-cli:latest formats
docker run --rm -v chatlab-data:/data \
  ghcr.io/chatlab/chatlab-cli:latest sessions --format json
```

## 環境變數

對於設定欄位，ChatLab 按照以下優先順序讀取值：

1. `CHATLAB_*` 環境變數
2. `~/.chatlab/config.toml` 或 `~/.chatlab/config.json`
3. 內建預設值

設定環境變數按照原始碼中的宣告順序如下：

| 環境變數 | 說明 |
| --- | --- |
| `CHATLAB_DATA_DIR` | 覆寫 ChatLab 資料目錄；映像將其設定為 `/data`。 |
| `CHATLAB_API_PORT` | 設定 `api.port`。`start` 命令會提供自己的預設值，因此請使用 `--port` 設定容器服務。 |
| `CHATLAB_API_HOST` | 設定 `api.host`。`start` 命令會提供自己的預設值，因此請使用 `--host` 設定容器服務。 |
| `CHATLAB_LLM_PROVIDER` | 設定 `llm.provider`。 |
| `CHATLAB_LLM_MODEL` | 設定 `llm.model`。 |
| `CHATLAB_LLM_BASE_URL` | 設定 `llm.base_url`。 |
| `CHATLAB_LOCALE_LANG` | 設定 `locale.lang`。 |
| `CHATLAB_CLI_ALLOW_RAW` | 設定為 `1` 或 `true`，允許查詢命令輸出未經隱私預處理的 `--raw` 結果。 |

ChatLab 也會讀取以下執行階段變數：

| 環境變數 | 說明 |
| --- | --- |
| `CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR` | 設定為 `1` 可略過資料目錄的最低執行階段版本檢查。此操作可能損壞資料，僅用於緊急復原。 |
| `CHATLAB_DISABLE_NATIVE_PERF` | 設定為 `1` 可停用原生解析器加速。 |
| `CHATLAB_LOG_LEVEL` | 將應用程式日誌層級設定為 `DEBUG`、`INFO`、`WARN` 或 `ERROR`，預設為 `INFO`。 |
| `CHATLAB_SKIP_UPDATE_CHECK` | 設定為任意非空值可停用 CLI 更新檢查。 |
| `CHATLAB_TEMP_ROOT` | 覆寫暫存工作區根目錄。 |
| `LANG` | 選擇 CLI 查詢預處理使用的預設語言。 |

Bearer Token、無介面模式、Web UI 驗證與瀏覽器開啟行為透過對應的命令列選項設定。ChatLab 不為這些選項提供環境變數別名。

## Docker Compose

```yaml
services:
  chatlab:
    image: ghcr.io/chatlab/chatlab-cli:latest
    restart: unless-stopped
    ports:
      - "3110:3110"
    volumes:
      - chatlab-data:/data
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

`CHATLAB_TOKEN` 由 Docker Compose 插值後作為 `--token` 的值傳給 ChatLab，並不是 ChatLab 環境變數。請將它儲存在密鑰儲存或未追蹤的 `.env` 檔案中。

## 多架構映像

Docker 會自動選擇與主機架構相符的映像。也可以明確選擇平台：

```bash
docker pull --platform linux/amd64 ghcr.io/chatlab/chatlab-cli:latest
docker pull --platform linux/arm64 ghcr.io/chatlab/chatlab-cli:latest
```

映像索引也包含來源證明。映像倉庫介面可能將這些中繼資料資訊清單顯示為 `unknown/unknown`；它們不是可執行平台，也不需要單獨拉取。
