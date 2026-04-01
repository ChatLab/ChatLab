#!/usr/bin/env bash
set -euo pipefail

# 读取项目根目录（默认当前目录，可通过参数覆盖）
ROOT_DIR="${1:-$(pwd)}"
TARGET_FILE="$ROOT_DIR/docs/changelogs_cn.json"

if [[ ! -f "$TARGET_FILE" ]]; then
  echo "错误: 未找到 $TARGET_FILE" >&2
  exit 1
fi

# 优先使用 Prettier，保证与本地保存时格式一致
if command -v npx >/dev/null 2>&1; then
  npx --yes prettier --write "$TARGET_FILE" >/dev/null
  echo "formatted_by=prettier"
  exit 0
fi

# 兜底：若无 npx，则仅做最小 JSON 格式化保证
node -e "const fs=require('fs');const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,'utf8'));fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');" "$TARGET_FILE"
echo "formatted_by=json_stringify_fallback"
