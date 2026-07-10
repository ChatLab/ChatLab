#!/bin/bash
#
# 在隔离目录中准备 better-sqlite3 的系统 Node.js 原生模块，
# 避免与 electron-rebuild 产生冲突。
#
# 优先下载官方 Node ABI 预编译包（秒级），无可用预编译时回退源码编译。
# 产物：apps/cli/native/better_sqlite3.node
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
TARGET_DIR="$SERVER_DIR/native"

# 获取当前 workspace 中 better-sqlite3 的版本
BS3_VERSION=$(node -e "const p = require('better-sqlite3/package.json'); console.log(p.version)")
echo "Building better-sqlite3@${BS3_VERSION} for system Node.js ($(node -v))..."

TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

cd "$TEMP_DIR"
npm init -y > /dev/null 2>&1
npm install "better-sqlite3@${BS3_VERSION}" --ignore-scripts > /dev/null 2>&1

cd "node_modules/better-sqlite3"
# better-sqlite3 按 Node ABI 发布预编译（无 napi 变体），与其自身 install 脚本保持一致
npx --yes prebuild-install || npm run build-release 2>/dev/null || npx --yes node-gyp rebuild --release

BUILT="$TEMP_DIR/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
if [ ! -f "$BUILT" ]; then
  echo "Error: native binary not found at $BUILT"
  exit 1
fi

mkdir -p "$TARGET_DIR"
cp "$BUILT" "$TARGET_DIR/better_sqlite3.node"

echo "Done. Native binary saved to $TARGET_DIR/better_sqlite3.node"
echo "  ABI: $(node -e 'console.log(process.versions.modules)')"
