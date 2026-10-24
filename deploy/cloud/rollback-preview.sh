#!/usr/bin/env bash
# 回退 UPC 预发布站到上一 release。只切换 symlink 并 reload nginx。
set -euo pipefail

HOST="${UPC_HOST:?set UPC_HOST, e.g. root@203.0.113.10}"
REMOTE_ROOT="${UPC_REMOTE_ROOT:-/var/www/upc}"
TARGET="${1:-}"

ssh "$HOST" "set -euo pipefail
  if [[ -z '$TARGET' ]]; then
    current=\$(readlink -f '$REMOTE_ROOT/current')
    previous=\$(ls -1dt '$REMOTE_ROOT'/releases/*/ | sed -n '2p')
    if [[ -z \"\$previous\" ]]; then echo 'no previous release' >&2; exit 1; fi
    echo \"current=\$current\"; echo \"previous=\$previous\"
  else
    previous='$REMOTE_ROOT/releases/$TARGET'
    if [[ ! -d \"\$previous\" ]]; then echo \"missing release: \$previous\" >&2; exit 1; fi
  fi
  sudo ln -sfn \"\$previous\" '$REMOTE_ROOT/current'
  sudo nginx -t
  sudo systemctl reload nginx
  readlink -f '$REMOTE_ROOT/current'
"
echo "rollback done; verify https://upc.example.org/ and auth callback"
