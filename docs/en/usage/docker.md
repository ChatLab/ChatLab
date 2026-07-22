---
outline: deep
---

# Docker Deployment

ChatLab CLI is available as a multi-architecture container image for
`linux/amd64` and `linux/arm64`:

```text
ghcr.io/chatlab/chatlab-cli
```

## Quick start

### Share data with Desktop and a local CLI (recommended)

ChatLab Desktop, CLI, and Docker can all use the host's `~/.chatlab` directory. When running Docker locally, bind mount that directory directly:

macOS / Linux:

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

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$HOME/.chatlab" | Out-Null

docker run --name chatlab `
  -p 127.0.0.1:3110:3110 `
  --mount "type=bind,source=$HOME/.chatlab,target=/home/node/.chatlab" `
  -e CHATLAB_DATA_DIR=/home/node/.chatlab/data `
  ghcr.io/chatlab/chatlab-cli:latest
```

Open <http://127.0.0.1:3110/> after the container starts.

The image normally runs as the unprivileged `node` user (UID/GID 1000). On
macOS and Linux, `--user` matches the container process to the owner of the bind
mount, while `HOME` keeps ChatLab's system directory at `/home/node/.chatlab`.
This is required on Linux hosts whose user UID/GID is not 1000. The host's
`~/.chatlab` maps to `/home/node/.chatlab`, and the host's `~/Downloads` maps
to the container's writable Downloads directory.
`CHATLAB_DATA_DIR` pins the default user data to the container-accessible
`/home/node/.chatlab/data`, so absolute paths from the host's `config.toml` do
not break inside the container.

With this setup, neither direction requires copying data:

- Start with Docker, then install Desktop or the local CLI: Desktop and CLI continue to read the host's `~/.chatlab`.
- Start with Desktop or the local CLI, then run Docker: Docker reads the existing configuration, chat databases, and AI data.

### Use Docker-only data

For a server deployment, or when you explicitly want data isolated from ChatLab on the host, use a Docker named volume:

```bash
docker run --name chatlab \
  -p 127.0.0.1:3110:3110 \
  -v chatlab-data:/home/node/.chatlab \
  ghcr.io/chatlab/chatlab-cli:latest
```

This volume preserves system state and user data inside Docker, but Desktop and the host CLI do **not** see that data automatically. Keep the `chatlab-data` volume when replacing or upgrading the container.

### Use a custom user data directory

If Desktop or CLI stores chat databases outside `~/.chatlab`, mount that directory separately and point the environment variable at its container path:

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

Replace `/absolute/path/to/chatlab-data` with the actual user data directory on the host. System data remains shared through the `~/.chatlab` mount. Because `CHATLAB_DATA_DIR` has the highest priority, change Docker's data directory through its mount and environment variable rather than the Storage settings page.

Desktop, CLI, and Docker on the same version can share the database. Before changing the data directory, running a migration, or switching between different versions, stop the other ChatLab instances first. If an older version cannot safely read an upgraded data directory, ChatLab's compatibility gate blocks startup.

## Server options

The default container command is:

```bash
chatlab start --no-open --host 0.0.0.0
```

The `chatlab start` options, in CLI declaration order, are:

| Option | Description |
| --- | --- |
| `--port <port>` | Server port. Defaults to `3110`. |
| `--host <host>` | Listen address. Defaults to `127.0.0.1` outside the container. |
| `--token <token>` | Custom Bearer token. ChatLab reads or generates one when omitted. |
| `--headless` | Start the API without serving the Web UI. |
| `--require-auth` | Require Bearer authentication for Web UI routes as well as API routes. |
| `--no-open` | Do not open a browser. |
| `--daemon` | Install a resident macOS/Linux service. This is not intended for containers. |

Docker arguments replace the complete default command. Repeat `start`,
`--no-open`, and `--host 0.0.0.0` when adding server options:

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

Other CLI commands can be selected directly:

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

## Environment variables

For configuration fields, ChatLab applies values in this order, from highest
to lowest priority:

1. `CHATLAB_*` environment variables
2. `~/.chatlab/config.toml` or `~/.chatlab/config.json`
3. Built-in defaults

The configuration environment variables, in source declaration order, are:

| Variable | Description |
| --- | --- |
| `CHATLAB_DATA_DIR` | Override the ChatLab user data directory. When set, mount the selected directory separately. |
| `CHATLAB_API_PORT` | Set `api.port`. The `start` command supplies its own default, so use `--port` to configure the container server. |
| `CHATLAB_API_HOST` | Set `api.host`. The `start` command supplies its own default, so use `--host` to configure the container server. |
| `CHATLAB_LLM_PROVIDER` | Set `llm.provider`. |
| `CHATLAB_LLM_MODEL` | Set `llm.model`. |
| `CHATLAB_LLM_BASE_URL` | Set `llm.base_url`. |
| `CHATLAB_LOCALE_LANG` | Set `locale.lang`. |
| `CHATLAB_CLI_ALLOW_RAW` | Set to `1` or `true` to allow privacy-unprocessed `--raw` query output. |

ChatLab also reads these runtime variables:

| Variable | Description |
| --- | --- |
| `CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR` | Set to `1` to bypass the minimum-runtime data-directory check. This may corrupt data and should only be used for emergency recovery. |
| `CHATLAB_DISABLE_NATIVE_PERF` | Set to `1` to disable native parser acceleration. |
| `CHATLAB_LOG_LEVEL` | Set the application log threshold to `DEBUG`, `INFO`, `WARN`, or `ERROR`. Defaults to `INFO`. |
| `CHATLAB_SKIP_UPDATE_CHECK` | Set to a non-empty value to disable CLI update checks. |
| `CHATLAB_TEMP_ROOT` | Override the temporary workspace root. |
| `LANG` | Select the default language used by CLI query preprocessing. |

Bearer tokens, headless mode, Web UI authentication, and browser opening are
configured with the corresponding command-line options. ChatLab does not
provide environment-variable aliases for those options.

## Docker Compose

First, create an untracked `.env` next to the Compose file:

```dotenv
CHATLAB_HOST_DIR=/absolute/path/to/.chatlab
CHATLAB_DOWNLOADS_DIR=/absolute/path/to/Downloads
CHATLAB_UID=1000
CHATLAB_GID=1000
CHATLAB_TOKEN=replace-with-a-secret-token
```

Replace `CHATLAB_HOST_DIR` with the absolute path to the host's `~/.chatlab`.
Set `CHATLAB_DOWNLOADS_DIR` to an existing writable directory for exports and
screenshots, such as the host's `~/Downloads`.
On macOS and Linux, replace `CHATLAB_UID` and `CHATLAB_GID` with the output of
`id -u` and `id -g`. Windows Docker Desktop users can keep `1000`.

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

`CHATLAB_TOKEN` is interpolated by Docker Compose and passed to ChatLab as the
value of `--token`; it is not a ChatLab environment variable. Keep it in a
secret store or an untracked `.env` file. If you need completely isolated
server data, use the named volume from "Use Docker-only data" above instead.

## Multi-architecture images

Docker selects the matching image for the host architecture automatically. To
select a platform explicitly:

```bash
docker pull --platform linux/amd64 ghcr.io/chatlab/chatlab-cli:latest
docker pull --platform linux/arm64 ghcr.io/chatlab/chatlab-cli:latest
```

The image index also contains provenance attestations. Registry interfaces may
display these metadata manifests as `unknown/unknown`; they are not runnable
platforms and do not need to be pulled separately.
