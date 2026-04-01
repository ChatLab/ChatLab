#!/usr/bin/env bash
set -euo pipefail

# 读取项目根目录（默认取当前目录，可通过第一个参数覆盖）
ROOT_DIR="${1:-$(pwd)}"

# 读取 package.json 中的当前版本号
CURRENT_VERSION="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(p.version||'');" "$ROOT_DIR/package.json")"
if [[ -z "$CURRENT_VERSION" ]]; then
  echo "错误: 无法从 package.json 读取 version" >&2
  exit 1
fi

# 基于 changelog 计算上一版本号：
# - 若当前版本已存在于 changelog 中，取其后一条作为上一版本
# - 若当前版本不存在，取首条作为上一版本
CHANGELOG_META="$(
  node -e "
    const fs=require('fs');
    const arr=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
    const current=process.argv[2];
    const idx=arr.findIndex(i=>i?.version===current);
    const exists=idx!==-1;
    const prev=exists ? (arr[idx+1]?.version||'') : (arr?.[0]?.version||'');
    process.stdout.write(JSON.stringify({exists, prev}));
  " "$ROOT_DIR/docs/changelogs_cn.json" "$CURRENT_VERSION"
)"

PREVIOUS_VERSION="$(node -e "const m=JSON.parse(process.argv[1]);process.stdout.write(m.prev||'');" "$CHANGELOG_META")"
CURRENT_EXISTS="$(node -e "const m=JSON.parse(process.argv[1]);process.stdout.write(String(Boolean(m.exists)));" "$CHANGELOG_META")"
if [[ -z "$PREVIOUS_VERSION" ]]; then
  echo "错误: 无法从 docs/changelogs_cn.json 读取上一版本" >&2
  exit 1
fi

CURRENT_TAG="v${CURRENT_VERSION}"
PREVIOUS_TAG="v${PREVIOUS_VERSION}"
RANGE=""

# 优先使用当前版本 tag；若不存在，则使用上一版本到 HEAD 的区间
if git -C "$ROOT_DIR" rev-parse --verify "$CURRENT_TAG" >/dev/null 2>&1; then
  RANGE="${PREVIOUS_TAG}..${CURRENT_TAG}"
else
  RANGE="${PREVIOUS_TAG}..HEAD"
fi

# 若上一版本 tag 不存在，回退为全量提交并提示原因
if ! git -C "$ROOT_DIR" rev-parse --verify "$PREVIOUS_TAG" >/dev/null 2>&1; then
  echo "WARN: 缺少上一版本 tag(${PREVIOUS_TAG})，回退为全量范围" >&2
  RANGE="$(git -C "$ROOT_DIR" rev-list --max-parents=0 HEAD | tail -n 1)..HEAD"
fi

# 输出版本和区间，便于技能调用方记录上下文
printf 'current_version=%s\n' "$CURRENT_VERSION"
printf 'previous_version=%s\n' "$PREVIOUS_VERSION"
printf 'current_exists=%s\n' "$CURRENT_EXISTS"
printf 'range=%s\n' "$RANGE"
echo "commits:"

# 输出提交哈希与标题，使用制表符分隔便于后续解析
# shellcheck disable=SC2016
git -C "$ROOT_DIR" log --no-merges --pretty=format:'%h%x09%s' "$RANGE"
