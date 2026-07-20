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

```bash
docker run --name chatlab \
  -p 127.0.0.1:3110:3110 \
  -v chatlab-data:/home/node/.chatlab \
  ghcr.io/chatlab/chatlab-cli:latest
```

Open <http://127.0.0.1:3110/> after the container starts.

The image runs as the unprivileged `node` user. The volume preserves system
state and user data under `/home/node/.chatlab`. Keep it when replacing or
upgrading the container.

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
  -p 8080:8080 \
  -v chatlab-data:/home/node/.chatlab \
  ghcr.io/chatlab/chatlab-cli:latest \
  start --port 8080 --host 0.0.0.0 --headless --no-open
```

Other CLI commands can be selected directly:

```bash
docker run --rm ghcr.io/chatlab/chatlab-cli:latest --version
docker run --rm ghcr.io/chatlab/chatlab-cli:latest formats
docker run --rm -v chatlab-data:/home/node/.chatlab \
  ghcr.io/chatlab/chatlab-cli:latest sessions --format json
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

`CHATLAB_TOKEN` is interpolated by Docker Compose and passed to ChatLab as the
value of `--token`; it is not a ChatLab environment variable. Keep it in a
secret store or an untracked `.env` file.

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
