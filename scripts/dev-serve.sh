#!/usr/bin/env bash
# Dev server with tsx watch — monitors workspace packages for changes.
set -e

pnpm run ensure:server-native

exec tsx watch \
  --include 'packages/core/src/**' \
  --include 'packages/node-runtime/src/**' \
  apps/cli/src/cli.ts start --headless --no-open "$@"
