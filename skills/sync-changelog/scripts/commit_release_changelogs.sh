#!/usr/bin/env bash
set -euo pipefail

# 在当前项目提交多语言 changelog，提交信息为 release: v<version>
# 用法：commit_release_changelogs.sh <repo_path>
REPO_PATH="${1:-}"
if [[ -z "$REPO_PATH" ]]; then
  echo "错误: 缺少仓库路径参数" >&2
  exit 1
fi

CN_FILE="$REPO_PATH/docs/changelogs_cn.json"
EN_FILE="$REPO_PATH/docs/changelogs_en.json"
TW_FILE="$REPO_PATH/docs/changelogs_tw.json"
JA_FILE="$REPO_PATH/docs/changelogs_ja.json"
PKG_FILE="$REPO_PATH/package.json"

if [[ ! -f "$CN_FILE" || ! -f "$EN_FILE" || ! -f "$TW_FILE" || ! -f "$JA_FILE" || ! -f "$PKG_FILE" ]]; then
  echo "错误: 多语言 changelog 或 package.json 不存在，无法提交" >&2
  exit 1
fi

VERSION="$(node -e "const fs=require('fs');const arr=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(arr?.[0]?.version||'');" "$CN_FILE")"
if [[ -z "$VERSION" ]]; then
  echo "错误: 无法从 $CN_FILE 读取当前版本" >&2
  exit 1
fi

# 仅暂存发布必需文件，避免误提交其他改动。
# 注意：package.json 中的版本号需要和 release 提交一起落盘。
git -C "$REPO_PATH" add \
  package.json \
  docs/changelogs_cn.json \
  docs/changelogs_en.json \
  docs/changelogs_tw.json \
  docs/changelogs_ja.json

# 若没有差异则不提交，避免空提交失败。
if git -C "$REPO_PATH" diff --cached --quiet; then
  echo "错误: 没有可提交的 changelog 变更" >&2
  exit 1
fi

MSG="release: v${VERSION}"
git -C "$REPO_PATH" commit -m "$MSG" >/dev/null

git -C "$REPO_PATH" rev-parse --short HEAD
