#!/usr/bin/env bash
set -euo pipefail

# 检查指定仓库是否干净，并确保位于 main 分支。
# 用法：preflight_main_clean.sh <repo_path> [allowlist_csv]
REPO_PATH="${1:-}"
ALLOWLIST_CSV="${2:-}"
if [[ -z "$REPO_PATH" ]]; then
  echo "错误: 缺少仓库路径参数" >&2
  exit 1
fi

if [[ ! -d "$REPO_PATH/.git" ]]; then
  echo "错误: $REPO_PATH 不是 git 仓库" >&2
  exit 1
fi

# 支持白名单：仅允许白名单内文件有改动，其他改动一律报错退出。
STATUS_OUTPUT="$(git -C "$REPO_PATH" status --porcelain)"
if [[ -n "$STATUS_OUTPUT" ]]; then
  if [[ -z "$ALLOWLIST_CSV" ]]; then
    echo "错误: $REPO_PATH 存在未提交或已暂存改动，请手动处理后重试" >&2
    exit 1
  fi

  ALLOWLIST_NL=""
  IFS=',' read -ra ALLOW_PATHS <<<"$ALLOWLIST_CSV"
  for allowed in "${ALLOW_PATHS[@]}"; do
    # 清理参数中可能出现的空格，避免调用时误传格式。
    cleaned="$(echo "$allowed" | xargs)"
    if [[ -n "$cleaned" ]]; then
      ALLOWLIST_NL+="$cleaned"$'\n'
    fi
  done

  # 遍历所有改动路径，存在任意非白名单路径则失败。
  while IFS= read -r line; do
    path="${line:3}"
    if [[ "$path" == *" -> "* ]]; then
      path="${path##* -> }"
    fi
    if ! printf '%s' "$ALLOWLIST_NL" | grep -Fxq "$path"; then
      echo "错误: $REPO_PATH 存在白名单外改动: $path" >&2
      exit 1
    fi
  done <<<"$STATUS_OUTPUT"
fi

CURRENT_BRANCH="$(git -C "$REPO_PATH" rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  # 仅在工作区干净时允许切换到 main。
  git -C "$REPO_PATH" checkout main >/dev/null
fi

FINAL_BRANCH="$(git -C "$REPO_PATH" rev-parse --abbrev-ref HEAD)"
if [[ "$FINAL_BRANCH" != "main" ]]; then
  echo "错误: 无法切换到 main 分支" >&2
  exit 1
fi

echo "ok: $REPO_PATH on main and clean"
