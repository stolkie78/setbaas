#!/usr/bin/env bash
# Deprecated shim — use ./scripts/deploy.sh demo
#
# Kept so existing server cron jobs and docs keep working.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "ℹ️  deploy-demo.sh is vervangen door: ./scripts/deploy.sh demo"
exec "$SCRIPT_DIR/deploy.sh" demo "$@"
